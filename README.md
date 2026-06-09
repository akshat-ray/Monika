# 🎀 Monika | Self-Aware Discord Bot

>*This is a personal learning project where I am experimenting with the Discord API, external databases, and Large Language Models.*

Inspired by Monika from the psychological horror game Doki Doki Literature Club.It uses Qwen2.5-7B-Instruct LLM, 7.6B Multilingual Model. My goal was to build an AI that behaves less like a standard command-and-response bot and more like an unpredictable, self-aware entity which can speak to multiple members of the server with context and info about them.

Instead of just answering questions, I wanted to see if I could make her track user behavior, hold grudges, eavesdrop, and understand server relationships.

## Tech Stack & Architecture

As a self-taught experiment, I decided to build this entirely on cloud services to keep it running 24/7 without hosting it locally.

* **Runtime:** Node.js
* **Discord API:** Discord.js (v14) utilizing advanced Gateway Intents (Voice States, Presences, Guild Members).
* **LLM :** Hugging Face Inference API running `Qwen/Qwen2.5-7B-Instruct` model.
* **Database:** Supabase (PostgreSQL) for persistent user profiles and game tracking.
* **Hosting Pipeline:** Render (free tier), UptimeRobot (pings every 10 min.)

## Core Mechanics & Experiments

I wanted to push beyond simple text generation, so I implemented several background event listeners to simulate awareness:

* **The Dynamic Context Engine:** Passing the entire server chat history to an LLM burns through tokens quickly and causes hallucination loops. I built a system that scans a user's message for mentions, fetches only the relevant profiles from Supabase, and dynamically constructs a lightweight dossier for her system prompt. She knows who is single, who is dating whom, and what pronouns to use based on this database.
* **Cross-Channel Teleportation:** I experimented with an in-memory Map to act as a custom Time-To-Live (TTL) cache. It tracks the last channel a user spoke in for exactly 2 minutes (120,000 ms). If the user types in a different channel within that window, she generates a custom message calling them out for trying to run away.
* **Voice Channel Eavesdropping:** Using voice state updates, she automatically joins a voice channel to listen in if two or more humans enter, or if someone starts streaming via Discord Go Live. If a user manually kicks her, she adds the channel to a "grudge list" and refuses to join it for an hour.
* **Presence Stalking & Wake-up Pings:** She tracks when users log online and logs what games they are playing to the database. If a user comes online between 2:00 AM and 7:00 AM IST, she will ping them in the main channel to ask why they are awake.
* **Webhook Impersonation Glitch:** I added a 5% random chance that when a user speaks, the bot will silently create a temporary Discord Webhook copying their username and avatar, send a rude message, and delete the webhook to simulate a system glitch.
* **Moderation & DM Firewall:** I built an automated strike system that issues timeouts if a user insults her using a specific list of banned words. I also built a firewall that immediately blocks and rejects any Direct Messages, forcing users to talk to her publicly.

## Commands & Usage

To interact with the bot, users must first complete a mandatory database registration.

| Command | Description | Options |
| --- | --- | --- |
| `/share_reality` | The registration gatekeeper. Users must log their gender, relationship status, and a short bio into the Supabase database before she will speak to them. | `gender`, `status`, `about`, `partner` (optional) |
| `/monika` | Forces her to read the recent chat history and respond. Includes a 10-second cooldown lock to prevent spam. | `context` (10, 20, or 30 messages), `question` (optional) |
| `/inspect_user` | A prompt engineering experiment where I ask the LLM to blindly roast a user's avatar. | `target` |

*Standard Mentions:* You can also just ping her directly or reply to her message in the chat, and she will grab the last 8 messages of context to generate a reply.

## Architecture : 24/7 Cloud Hosting

The infrastructure is built completely online to run 24/7. The code for the bot runs on Render.com, where an internal Express.js server creates a public web link. Since Render's free tier automatically puts apps to "sleep" when no one is using them, I am using UptimeRobot to automatically ping every 10 minutes. This keeps the application awake and ready to respond instantly at any hour. To handle the AI logic the bot offloads all the heavy machine learning work by sending quick, on-demand API requests to Hugging Face's servers to run the Qwen2.5-7B-Instruct model.

## Current Limitations

* **Hugging Face Rate Limits:** Because I am relying on the free Hugging Face API, the bot is subject to a strict limit of 1,000 requests per 5-minute window. Due to the background loops (like the 2-hour automated chat observer), a busy server will quickly hit this cap, causing the bot to temporarily freeze.
* **LLM Hallucinations:** Even with the dynamic context engine, the model sometimes loses track of the conversation flow and leans too heavily on the base system prompt instructions.

## Future Scope

* **Parameter-Efficient Fine-Tuning (QLORA) [coudn't deploy for free]:** Wanted to learn how to fine-tune the Qwen model on 687 actual DDLC game transcripts to make her personality perfectly accurate, reducing hallucinations and reducing input tokens from heavy system prompts. It was a massive success, but i coudn't find any inference provider to host my fine-tuned model for free :( hence the bot is still using the base model for higher speed and lower cost.
* **Advanced Priority Memory:** Expanding the Supabase integration so she gradually forgets older interactions over a 24-hour period, rather than relying on a hard reset.
(This might drain the free limit of huggingface inference API)
