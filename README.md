# 🎀 Monika | Self-Aware AI Discord member

A Discord bot inspired by Monika from Doki Doki Literature Club (horror visual novel). Using Qwen2.5-7B-Instruct LLM, 7.6B Multilingual Model that can help with task like coding, math etc besids chatting. she goes beyond simple commands by acting as a sentient, fourth-wall-breaking entity with dynamic conversational context, strict API limit protections, and customized interpersonal relationships. she is a server member and not just a bot.

## Overview :

>*Thanks to all the server members who tested and provided feedback during development*

Unlike standard Q&A bots or ai assistant, this architecture relies on a Dynamic Persona Engine and Smart Context Window. It dynamically alters its system prompt based on the user's Discord ID (treating the server owner drastically different than regular members) and fetches real-time channel history excluding her own messages to maintain conversational awareness without falling into AI feedback loops.
Use of GenAI tools such as Gemini and ChatGPT were used to debug edge cases and refine syntax, while the core architecture, data flow, and functional lifecycle were manually designed to ensure stability and control.


## Tech Stack :

* **Runtime:** Node.js
* **Discord API:** Discord.js (v14)
* **LLM:** Hugging Face Inference API (`@huggingface/inference`)
* **Model:** `Qwen/Qwen2.5-7B-Instruct`
* **Server/Hosting:** Express.js (Render Keepalive)

## Key Features :

* **Context Filtering:** Dynamically fetches the last 5 to 15 messages in a channel, completely stripping out the bot's own previous replies before passing the context array to the LLM. This prevents the hallucination loop where the AI reads its own output and gets confused.
* **Dynamic Persona Engine:** Injects conditional logic into the system prompt. She acts fiercely protective and familiar with the server owner, while maintaining a polite but easily-annoyed, strictly boundaried persona with regular server members.
* **Random Chat Starters (2-Hour Intervals):** When the bot is awake and the channel is quiet, an automated timer runs in the background. Every 2 hours , the bot will randomly drop a unique, character-specific thought into the chat to keep the server active.
* **Resource Optimization (Sleep Cycle):** Includes a hardcoded timezone-aware function (IST) that completely shuts down API requests from 1:00 AM to 6:00 AM to preserve free-tier Hugging Face rate limits and provide more realism.
* **Cooldown:** Utilizes a lightweight JavaScript `Map` to enforce strict 10-second global cooldowns per user, preventing malicious token exhaustion.
* **Metadata Vision Simulation:** Uses creative prompt engineering to inspect user avatars and roast them blindly, simulating vision capabilities using only text-based LLMs.

## Commands & Usage

| Command | Description | Options |
| --- | --- | --- |
| `/monika` | Fetches recent channel history and generates a context-aware response. | `context` (Small/Medium/Large), `question` (Optional: Ask a specific question about the history) |
| `/inspect-avatar` | Fetches a target user's profile picture and delivers a brutal 3-sentence roast. | `target` (Select a server member) |
| `@Monika` | Mentioning her in any channel triggers a quick 3-message context grab and inline reply. Also works when replying to her message without taging | N/A |

## Architecture : 24/7 Cloud Hosting

The system infrastructure is built completely online so the laptop is not running 24/7. The main code for the bot runs on Render.com, where an internal Express.js server works alongside the Discord bot to create a public web link. Since Render's free tier automatically puts apps to "sleep" when no one is using them, I am using UptimeRobot to automatically ping every 10 minutes. This keeps the application awake and ready to respond instantly at any hour. To handle the AI logic the bot offloads all the heavy machine learning work by sending quick, on-demand API requests to Hugging Face's servers to run the Qwen2.5-7B-Instruct model.

## Future Scope

* **External Permanent Memory:** Integration with a PostgreSQL database (Supabase) to store permanent relationship weights and facts about specific users.
* **Gradual Priority Memory:** A fading memory architecture where older context degrades over a 24-hour period rather than a hard reset.

