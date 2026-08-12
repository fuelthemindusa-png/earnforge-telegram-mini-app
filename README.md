# EarnForge — Backend Step 1

Connects the frontend to the Supabase Edge Function for:
- Initial player/state loading
- Server-authoritative tap rewards
- Server-side $5 tap-cycle limit
- Server-side energy
- Server-side Earning Power level

Before deployment, replace `https://YOUR_PROJECT_ID.supabase.co/functions/v1/game-api` in `app.js` with your actual Edge Function URL.

Do NOT put Supabase secret keys or the Telegram bot token in this frontend.

Tasks and upgrades remain local for this step. We will migrate them after state/tap is tested.
Open the app inside Telegram because Telegram initData is required.
