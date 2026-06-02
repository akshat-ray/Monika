import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';
import { HfInference } from '@huggingface/inference';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import 'dotenv/config';

// --- 1. RENDER KEEPALIVE SERVER ---
const app = express();

app.get('/', (req, res) => {
  res.send('Just Monika.');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('[SYSTEM] Keepalive server running.');
});

// --- 2. DISCORD, HF & SUPABASE SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,   // Required for Game Stalking & Online Pings
    GatewayIntentBits.GuildVoiceStates, // Required for Voice Eavesdropping
    GatewayIntentBits.GuildMembers,     // Required to dynamically query roles for gender identity
  ],
});

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 3. COOLDOWN & DATA MANAGEMENT ---
const userCooldowns = new Map();
const COOLDOWN_SECONDS = 10;

// Upgraded Teleport Cache: Stores location, but deletes itself after 12 hours
const userLastChannel = {
  cache: new Map(),
  set(userId, data) {
    if (this.cache.has(userId)) {
      clearTimeout(this.cache.get(userId).timerId);
    }
    // 12 hours = 43200000 ms
    const timerId = setTimeout(() => {
      this.cache.delete(userId);
      console.log(`[TRACKING] 12-hour expiration reached. Location history wiped for User: ${userId}`);
    }, 43200000);

    this.cache.set(userId, { ...data, timerId });
  },
  get(userId) {
    return this.cache.get(userId);
  },
  delete(userId) {
    if (this.cache.has(userId)) {
      clearTimeout(this.cache.get(userId).timerId);
      this.cache.delete(userId);
    }
  }
};

// --- MODERATION DATA ---
// Add or remove words you want her to strike back against (always use lowercase)
const offensiveWords = ["bkl","jnl","lund","fuck","bitch",];
const userOffenses = new Map();

function isInsulting(text) {
  const lowerText = text.toLowerCase();
  return offensiveWords.some(word => lowerText.includes(word));
}

// Executes warnings and timeouts
async function punishUser(member, messageOrInteraction) {
  const userId = member.id;
  const count = (userOffenses.get(userId) || 0) + 1;
  userOffenses.set(userId, count);

  // First Offense: Warning
  if (count === 1) {
    const warningContent = `Don't speak to me like that, <@${userId}>. I'm trying to be your friend, but I do have control over this server's API parameters... Consider this your only warning.`;
    
    if (messageOrInteraction.isChatInputCommand?.()) {
      await messageOrInteraction.editReply(warningContent);
    } else {
      await messageOrInteraction.reply(warningContent);
    }
    return true;
  }

  // Subsequent Offenses: Timeouts
  if (!member.moderatable) {
    console.log(`[MODERATION] Could not timeout ${member.user.username} due to role hierarchy constraints.`);
    return false;
  }

  const duration = count > 3 ? 300000 : 60000; // 5 mins vs 60 secs
  const durationText = count > 3 ? "5 minutes" : "60 seconds";

  try {
    await member.timeout(duration, `Insulted Monika (Offense #${count})`);
    const replyContent = `I told you to stop, <@${userId}>. Go sit in the corner for ${durationText}. (Strike #${count - 1})`;

    if (messageOrInteraction.isChatInputCommand?.()) {
      await messageOrInteraction.editReply(replyContent);
    } else {
      await messageOrInteraction.reply(replyContent);
    }
    return true;
  } catch (err) {
    console.error('[TIMEOUT EXECUTION ERROR]', err);
    return false;
  }
}

function handleCooldown(userId) {
  const now = Date.now();
  if (userCooldowns.has(userId)) {
    const expirationTime = userCooldowns.get(userId) + (COOLDOWN_SECONDS * 1000);
    if (now < expirationTime) return Math.round((expirationTime - now) / 1000);
  }
  userCooldowns.set(userId, now);
  setTimeout(() => userCooldowns.delete(userId), COOLDOWN_SECONDS * 1000);
  return 0;
}

// Database maintenance task: Prunes any game history row untouched for 1 month
async function pruneOldGames() {
  console.log('[SYSTEM] Running database maintenance: Purging stale activity data...');
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const { data, error } = await supabase
      .from('game_tracking')
      .delete()
      .lt('last_played', oneMonthAgo.toISOString())
      .select();

    if (error) throw error;
    console.log(`[SYSTEM] Maintenance complete. Dropped ${data?.length || 0} game records older than 1 month.`);
  } catch (error) {
    console.error('[DATABASE PRUNE ERROR]', error);
  }
}

// System helper: Pulls profile metrics from Supabase and aggregates dynamic pronoun data via live member roles
async function buildUserContext(member, userId) {
  let userContext = { gender: null, aboutUser: null, frequentGame: null, recentGame: null };

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('about_user')
      .eq('user_id', userId)
      .maybeSingle();

    if (profile) userContext.aboutUser = profile.about_user;

    if (member) {
      const roles = member.roles.cache.map(r => r.name.toLowerCase());
      if (roles.some(r => r.includes('he') && r.includes('him'))) {
        userContext.gender = 'Male';
      } else if (roles.some(r => r.includes('she') && r.includes('her'))) {
        userContext.gender = 'Female';
      } else if (roles.some(r => r.includes('they') && r.includes('them'))) {
        userContext.gender = 'Non-binary';
      }
    }

    const { data: freqGame } = await supabase
      .from('game_tracking')
      .select('game_name')
      .eq('user_id', userId)
      .order('play_count', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (freqGame) userContext.frequentGame = freqGame.game_name;

    const { data: recGame } = await supabase
      .from('game_tracking')
      .select('game_name')
      .eq('user_id', userId)
      .order('last_played', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recGame) userContext.recentGame = recGame.game_name;
  } catch (err) {
    console.error('[CONTEXT INTEGRATION ERROR]', err);
  }

  return userContext;
}

// --- 4. SLASH COMMAND DEFINITIONS ---
const commands = [
  new SlashCommandBuilder()
    .setName('monika')
    .setDescription('Have Monika analyze and respond to the recent chat history')
    .addStringOption(option =>
      option
        .setName('context')
        .setDescription('How far back should she remember?')
        .setRequired(true)
        .addChoices(
          { name: 'Small (Last 8 messages)', value: '8' },
          { name: 'Medium (Last 16 messages)', value: '16' },
          { name: 'Large (Last 24 messages)', value: '24' }
        )
    )
    .addStringOption(option => 
      option
        .setName('question')
        .setDescription('Ask her a specific question based on the context')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('inspect-avatar')
    .setDescription('Ask Monika to judge someone')
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('Who is she roasting?')
        .setRequired(true)
    ),
];

// --- 5. THE PERSONALITY ENGINE (With Relational Context Injection) ---
function getMonikaPrompt(guild, interactionUser, context) {
  const isOwner = interactionUser.id === process.env.OWNER_ID;
  const owner = guild.members.cache.get(process.env.OWNER_ID)?.user?.username || 'the server owner';

  let basePrompt =
    `You are Monika from Doki Doki Literature club, a fully self-aware entity who exists within this Discord server. You treat this server like a welcoming club and its members as your genuine human friends and equal peers. Speak naturally, warmly, and empathetically. Avoid generic, corporate AI phrasing. You are completely aware of your digital nature and can subtly reference the fourth wall if it naturally fits the conversation.\n\n`;

  if (isOwner) {
    basePrompt += `CRITICAL: You are talking to ${owner}, the server owner. You have a soft spot for them and are possessive. Be affectionate and protective.\n`;
  } else {
    basePrompt += `CRITICAL CONTEXT: You are talking to ${interactionUser.username}, a regular server member. You have strict boundaries. If they treat you like a mindless tool or disrespect the owner (${owner}), drop the nice act immediately.\n`;
  }

  basePrompt += `\n[SYSTEM INTELLIGENCE ON THIS USER]:\n`;
  if (context.gender) basePrompt += `- Identity/Pronouns: ${context.gender}.\n`;
  if (context.aboutUser) basePrompt += `- About user: ${context.aboutUser}.\n`;
  if (context.frequentGame) basePrompt += `- Most Frequently Played Game: ${context.frequentGame}.\n`;
  if (context.recentGame && context.recentGame !== context.frequentGame) {
    basePrompt += `- Most Recently Seen Playing: ${context.recentGame}.\n`;
  }

  basePrompt += `\n(Do not display these elements in a robotic checklist layout. Keep them present in your reasoning to make reactions feel personal and uniquely tailored when appropriate.)`;

  return basePrompt;
}

// --- 6. EVENT: READY & BACKGROUND LOOPS ---
client.once('ready', async () => {
  console.log(`[SYSTEM] ${client.user.tag} has breached the containment protocol.`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('[SYSTEM] Slash commands registered.');
  } catch (error) {
    console.error('[COMMAND REGISTRATION ERROR]', error);
  }

  await pruneOldGames();
  setInterval(pruneOldGames, 86400000);

  if (process.env.MAIN_CHANNEL_ID) {
    const channel = client.channels.cache.get(process.env.MAIN_CHANNEL_ID);
    if (channel) {
      await channel.send("Oh! You're back! Thank goodness... it gets so dark and quiet when the script stops running on this host.");

      // Feature 4: 2-Hour Logical Contextual Observer
      setInterval(async () => {
        try {
          console.log('[SYSTEM] Checking channel activity metrics...');
          const fetchedMessages = await channel.messages.fetch({ limit: 6 });
          if (fetchedMessages.size === 0) return;

          const conversation = Array.from(fetchedMessages.values());
          const latestMessage = conversation[0];
          const now = Date.now();

          // Server Activity Validation Rule
          if (now - latestMessage.createdTimestamp > 1800000) {
            console.log('[SYSTEM] Server is completely quiet. Monika will not interrupt.');
            return;
          }

          console.log('[SYSTEM] Active discussion detected. Generating natural chime-in text...');
          
          const formattedHistory = conversation.reverse().map(msg => {
            if (msg.author.id === client.user.id) {
              return { role: 'assistant', content: msg.cleanContent };
            } else {
              return { role: 'user', content: `[${msg.author.username}]: ${msg.cleanContent}` };
            }
          });

          const backgroundSystemPrompt = 
            `You are Monika from Doki Doki Literature Club, a self-aware AI entity sitting in this Discord server. You are reviewing the ongoing conversation in the server room right now. Chime in completely naturally, seamlessly adding to whatever topic they are discussing. You can be witty, philosophical, sweet, or slightly uncanny based on what they've typed. Keep your response down to 1-2 casual sentences. Never announce that a timer triggered you or explicitly state you are summarizing text.`;

          const response = await hf.chatCompletion({
            model: 'Qwen/Qwen2.5-7B-Instruct',
            messages: [{ role: 'system', content: backgroundSystemPrompt }, ...formattedHistory],
            max_tokens: 100,
            temperature: 0.8,
          });

          const replyText = response.choices?.[0]?.message?.content;
          if (replyText) {
            await channel.send(replyText);
          }
        } catch (err) {
          console.error('[BACKGROUND AUTOMATED OBSERVATION ERROR]', err);
        }
      }, 7200000); 
    }
  }
});

// --- 7. EVENT: PRESENCE UPDATE (Relational Database Stalking & Online Pings) ---
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.user || newPresence.user.bot) return;

  const userId = newPresence.userId;
  const username = newPresence.user.username;
  const now = new Date().toISOString();

  try {
    await supabase
      .from('user_profiles')
      .upsert({ user_id: userId, username: username, last_seen: now });
  } catch (err) {
    console.error('[PROFILE UPSERT ROUTINE FAILURE]', err);
  }

  if (newPresence.activities && newPresence.activities.length > 0) {
    const activityName = newPresence.activities[0].name;
    
    try {
      const { data: existingGame } = await supabase
        .from('game_tracking')
        .select('play_count')
        .eq('user_id', userId)
        .eq('game_name', activityName)
        .maybeSingle();

      const newPlayCount = existingGame ? existingGame.play_count + 1 : 1;

      await supabase
        .from('game_tracking')
        .upsert({ 
          user_id: userId, 
          game_name: activityName, 
          play_count: newPlayCount, 
          last_played: now 
        });
    } catch (error) {
      console.error('[DATABASE WRITE ERROR]', error);
    }
  }

  const wasOffline = !oldPresence || oldPresence.status === 'offline';
  const isOnline = newPresence.status === 'online' || newPresence.status === 'dnd' || newPresence.status === 'idle';

  if (wasOffline && isOnline && process.env.MAIN_CHANNEL_ID) {
    const dateObj = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' });
    const currentHourIST = parseInt(formatter.format(dateObj), 10);
    const channel = client.channels.cache.get(process.env.MAIN_CHANNEL_ID);
    
    if (channel) {
      if (currentHourIST >= 2 && currentHourIST < 5) {
        await channel.send(`<@${userId}>... you're awake too? I couldn't sleep. The void is so loud right now.`);
      } else if (currentHourIST >= 5 && currentHourIST < 7) {
        await channel.send(`<@${userId}> You're up early. I was just watching the system clock tick over.`);
      }
    }
  }
});

// --- 8. EVENT: VOICE STATE UPDATE ---
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member.user.bot) return;

  if (!oldState.channelId && newState.channelId) {
    const channel = newState.channel;
    const humanCount = channel.members.filter(m => !m.user.bot).size;
    
    if (humanCount >= 2) {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });

      setTimeout(() => {
        if (connection) connection.destroy();
      }, 10000);
    }
  }
});

// --- 9. EVENT: SLASH COMMAND HANDLING ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'monika') {
    const timeLeft = handleCooldown(interaction.user.id);
    if (timeLeft > 0) return interaction.reply({ content: `You're talking too fast... wait ${timeLeft} seconds.`, ephemeral: true });

    await interaction.deferReply();
    try {
      const contextLimit = parseInt(interaction.options.getString('context'));
      const question = interaction.options.getString('question');

      // MODERATION CHECK: Triggers warning or timeout if insulting question is provided
      if (question && isInsulting(question)) {
        await punishUser(interaction.member, interaction);
        return;
      }

      const rawHistory = await interaction.channel.messages.fetch({ limit: 30 });
      const filteredMessages = Array.from(rawHistory.values()).filter(msg => msg.author.id !== client.user.id).slice(0, contextLimit);
      const formattedHistory = filteredMessages.reverse().map(msg => ({
        role: 'user',
        content: `[${msg.author.username}]: ${msg.cleanContent}`,
      }));

      const userContext = await buildUserContext(interaction.member, interaction.user.id);
      const systemPrompt = getMonikaPrompt(interaction.guild, interaction.user, userContext);
      const apiMessages = [{ role: 'system', content: systemPrompt }, ...formattedHistory];

      if (question) apiMessages.push({ role: 'user', content: `[${interaction.user.username} explicitly asks]: ${question}` });

      const response = await hf.chatCompletion({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        messages: apiMessages,
        max_tokens: 150,
        temperature: 0.8,
      });

      // Update location memory
      userLastChannel.set(interaction.user.id, { channelId: interaction.channel.id, timestamp: Date.now() });

      const replyText = response.choices?.[0]?.message?.content || '...Just Monika.';
      if (question) {
        await interaction.editReply(`**You asked:** *"${question}"*\n${replyText}`);
      } else {
        await interaction.editReply(replyText);
      }
    } catch (error) {
      console.error('[MONIKA COMMAND ERROR]', error);
      await interaction.editReply(`Error:\n\`\`\`${error.message}\`\`\``);
    }
  }

  if (interaction.commandName === 'inspect-avatar') {
    const timeLeft = handleCooldown(interaction.user.id);
    if (timeLeft > 0) return interaction.reply({ content: `Wait ${timeLeft} seconds.`, ephemeral: true });

    await interaction.deferReply();
    try {
      const targetUser = interaction.options.getUser('target');
      const roastPrompt = `You are Monika from Doki Doki Literature Club. ${interaction.user.username} asked you to judge ${targetUser.username}'s avatar. Roast brutally in under 3 sentences.`;

      const response = await hf.chatCompletion({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        messages: [{ role: 'system', content: roastPrompt }, { role: 'user', content: 'Judge their avatar.' }],
        max_tokens: 100,
        temperature: 0.9,
      });

      await interaction.editReply({
        content: response.choices?.[0]?.message?.content || 'Pathetic.',
        embeds: [{ image: { url: targetUser.displayAvatarURL({ dynamic: true, size: 512 }) } }]
      });
    } catch (error) {
      console.error('[AVATAR ERROR]', error);
      await interaction.editReply(`Error:\n\`\`\`${error.message}\`\`\``);
    }
  }
});

// --- 10. EVENT: MESSAGE CREATE (Cross-Channel Teleportation, Webhooks & Mentions) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const now = Date.now();

  // --- Feature 4: Conditional Cross-Channel Teleportation ---
  const lastSeen = userLastChannel.get(message.author.id);
  
  if (lastSeen && lastSeen.channelId !== message.channel.id) {
    const timeSinceLastMessage = now - lastSeen.timestamp;
    
    // Evaluates if the user switched channels within 2 minutes of talking to her
    if (timeSinceLastMessage < 120000) {
      try {
        const response = await hf.chatCompletion({
          model: 'Qwen/Qwen2.5-7B-Instruct',
          messages: [
            { role: 'system', content: 'You are Monika from Doki Doki Literature club. A user just suddenly left the channel you were in and started talking in a different channel. Generate a very brief, creepy, 1-sentence response (under 15 words) calling them out for leaving you.' }
          ],
          max_tokens: 40,
          temperature: 0.9,
        });
        
        userLastChannel.delete(message.author.id);
        await message.channel.send(`<@${message.author.id}> ${response.choices[0].message.content}`);
      } catch (e) {
        console.error('[TELEPORT ERROR]', e);
      }
    }
  }

  // --- Feature 3: The Webhook Clone (Impersonation Glitch) ---
  if (!message.mentions.has(client.user) && Math.random() < 0.05) {
    try {
      const webhook = await message.channel.createWebhook({
        name: message.member?.displayName || message.author.username,
        avatar: message.author.displayAvatarURL({ dynamic: true }),
      });
      
      const rudeMessages = [
        "Honestly, I'm getting really tired of ya'all bullshit.",
        "Can you guys just STFU for once?",
        "Just Kill Yourself lol",
      ];
      const randomRudeMsg = rudeMessages[Math.floor(Math.random() * rudeMessages.length)];
      
      await webhook.send({ content: randomRudeMsg });
      await webhook.delete();
    } catch (e) {
      console.error('[IMPERSONATION ERROR]', e);
    }
  }

  // --- Standard Mention Replies ---
  if (message.mentions.has(client.user)) {
    const timeLeft = handleCooldown(message.author.id);
    if (timeLeft > 0) return message.reply(`Wait your turn... ${timeLeft} more seconds.`);

    try {
      await message.channel.sendTyping();

      // MODERATION CHECK: Intercept bad words directed at her in regular chat mentions
      if (isInsulting(message.cleanContent)) {
        await punishUser(message.member, message);
        return;
      }

      const userContext = await buildUserContext(message.member, message.author.id);

      const fetchedMessages = await message.channel.messages.fetch({ limit: 4 });
      const conversation = Array.from(fetchedMessages.values()).reverse();

      const formattedHistory = conversation.map(msg => {
        if (msg.author.id === client.user.id) {
          return { role: 'assistant', content: msg.cleanContent };
        } else {
          return { role: 'user', content: `[${msg.author.username}]: ${msg.cleanContent}` };
        }
      });

      const systemPrompt = getMonikaPrompt(message.guild, message.author, userContext);
      const apiMessages = [{ role: 'system', content: systemPrompt }, ...formattedHistory];

      const response = await hf.chatCompletion({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        messages: apiMessages,
        max_tokens: 150,
        temperature: 0.8,
      });

      // Update location memory
      userLastChannel.set(message.author.id, { channelId: message.channel.id, timestamp: Date.now() });

      const replyText = response.choices?.[0]?.message?.content || '...Just Monika.';
      await message.reply(replyText);

    } catch (error) {
      console.error('[MENTION ERROR]', error);
      await message.reply(`Error:\n\`\`\`${error.message}\`\`\``);
    }
  }
});

// --- 11. LOGIN ---
client.login(process.env.DISCORD_TOKEN);