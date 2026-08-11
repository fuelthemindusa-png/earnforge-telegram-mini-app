# EarnForge — Monetag Zone 11556400

Monetag SDK:
<script src="//libtl.com/sdk.js" data-zone="11556400" data-sdk="show_11556400"></script>

Integrated formats:
- Rewarded Interstitial: `show_11556400()` before task rewards.
- Rewarded Popup: `show_11556400("pop")` before upgrade purchases.
- In-App Interstitial: automatic configuration:
  frequency 2, capping 0.1 hours, interval 30 seconds, timeout 5 seconds, everyPage false.

Game rules retained:
- $0.01 base tap reward.
- +$0.01 tap reward per Power upgrade.
- $5 tap-earnings limit per daily cycle, reset at 6 AM.
- Energy starts at 100; +5 per Energy upgrade.
- Base energy reset 5 hours; -10 minutes per Recharge upgrade; minimum 10 minutes.
- Upgrade prices double after every purchase.
- $100 minimum withdrawal UI.
- Rank/Leaderboard removed.

The displayed earnings and withdrawal are virtual game values in this frontend prototype.
