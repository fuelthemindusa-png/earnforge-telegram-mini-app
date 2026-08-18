const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("#080b12");
    tg.setBackgroundColor("#080b12");
  } catch (_) {}
}

const screen = document.getElementById("screen");
const navButtons = [...document.querySelectorAll("nav button")];

// ===============================
// BACKEND API
// ===============================

const API_BASE_URL = "https://dyuvorvwhatdcrhnbthh.supabase.co/functions/v1/game-api";

function telegramInitData() {
  return tg?.initData || "";
}

async function apiRequest(endpoint, method = "POST", body = {}) {
  const initData = telegramInitData();

  if (!initData) {
    throw new Error("Open EarnForge inside Telegram. Telegram initData is missing.");
  }

  const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, initData })
  });

  let data = {};
  try { data = await response.json(); } catch (_) {}

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `API error (${response.status})`);
  }

  return data;
}

function applyServerState(serverState) {
  if (!serverState) return;

  st.balance = Number(serverState.balance || 0);
  st.lifetime = Number(serverState.lifetime_earnings || 0);
  st.tapEarnedToday = Number(serverState.tap_earnings_today || 0);
  st.energy = Number(serverState.energy || 0);
  st.maxEnergy = Number(serverState.max_energy || BASE_MAX_ENERGY);
  st.lastEnergyReset = new Date(serverState.last_energy_reset).getTime();

  st.upgrades.power = Number(serverState.power_level || 0);
  st.upgrades.energy = Number(serverState.energy_level || 0);
  st.upgrades.recharge = Number(serverState.recharge_level || 0);

  st.streak = Number(serverState.streak || 0);
  st.lastBoost = serverState.last_boost
    ? new Date(serverState.last_boost).getTime()
    : 0;
  st.tapResetKey = getTapCycleKey(new Date(serverState.tap_cycle_start));

  save();
}

async function syncServerState() {
  const data = await apiRequest("state", "POST");
  applyServerState(data.state);
  return data.state;
}

async function serverTap() {
  try {
    const requestId =
      crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const data = await apiRequest(
      "tap",
      "POST",
      {
        requestId
      }
    );

    if (!data?.ok) {
      throw new Error(data?.error || "Tap failed");
    }

    applyServerState(data.state);

    return data;

  } catch (error) {
    console.error("Tap error:", error);
    showToast(error.message || "Tap failed");
    return null;
  }
}

async function serverTask(key) {
  const data = await apiRequest("task", "POST", { task: key });
  applyServerState(data.state);
  return data;
}

async function serverUpgrade(key) {
  const data = await apiRequest("upgrade", "POST", { upgrade: key });
  applyServerState(data.state);
  return data;
}

async function serverWithdrawal() {
  return await apiRequest("withdrawal", "POST");
}

async function loadWithdrawalStatus() {
  return await apiRequest("withdrawal-status", "POST");
}

// ===============================
// GAME RULES
// ===============================

const DAY_START_HOUR = 6;

// Base tap reward. Each Power upgrade adds $0.01.
const BASE_TAP_REWARD = 0.01;

// Tap earnings have a separate $5 daily-cycle limit.
const TAP_DAILY_LIMIT = 5.00;

// Base energy and reset.
const BASE_MAX_ENERGY = 100;
const BASE_ENERGY_RESET_MS = 5 * 60 * 60 * 1000;

// Each Energy Capacity upgrade adds exactly +5 max energy.
const ENERGY_UPGRADE_GAIN = 5;

// Each Recharge Speed upgrade removes 10 minutes.
const RECHARGE_REDUCTION_MS = 10 * 60 * 1000;

// Do not allow the timer to become shorter than 10 minutes.
const MIN_ENERGY_RESET_MS = 10 * 60 * 1000;

// ===============================
// STATE
// ===============================

const defaultState = {
  balance: 4.82,
  lifetime: 67.33,

  // Tap-only daily counter.
  tapEarnedToday: 0,
  tapResetKey: "",

  energy: 82,
  maxEnergy: BASE_MAX_ENERGY,
  lastEnergyReset: Date.now(),

  level: 0,
  streak: 0,
  lastBoost: 0,

  upgrades: {
    power: 0,
    energy: 0,
    recharge: 0
  },

  tasks: {
    check: false,
    boost: false,
    ad: false,
    streak: false
  },

  history: [
    ["Today", "+$4.82"],
    ["Yesterday", "+$3.91"],
    ["Aug 08", "+$4.17"],
    ["Aug 07", "+$2.83"]
  ]
};

let st = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("earnforge_state") || "null");

    if (!saved) return structuredClone(defaultState);

    const result = {
      ...defaultState,
      ...saved,
      upgrades: {
        ...defaultState.upgrades,
        ...(saved.upgrades || {})
      },
      tasks: {
        ...defaultState.tasks,
        ...(saved.tasks || {})
      }
    };

    // Migrate old versions safely.
    if (!Number.isFinite(result.maxEnergy) || result.maxEnergy < BASE_MAX_ENERGY) {
      result.maxEnergy = BASE_MAX_ENERGY;
    }

    if (!Number.isFinite(result.energy) || result.energy < 0) {
      result.energy = result.maxEnergy;
    }

    return result;
  } catch (_) {
    return structuredClone(defaultState);
  }
}

function save() {
  localStorage.setItem("earnforge_state", JSON.stringify(st));
}

function money(value) {
  return "$" + Number(value || 0).toFixed(2);
}

function toast(message) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// ===============================
// UPGRADE VALUES
// ===============================

function currentTapReward() {
  return BASE_TAP_REWARD + (st.upgrades.power * 0.01);
}

function currentEnergyResetMs() {
  return Math.max(
    MIN_ENERGY_RESET_MS,
    BASE_ENERGY_RESET_MS -
      (st.upgrades.recharge * RECHARGE_REDUCTION_MS)
  );
}

function nextEnergyGain() {
  return ENERGY_UPGRADE_GAIN;
}

// Every upgrade's own price doubles.
// Power: 1.50, 3.00, 6.00...
// Energy: 1.25, 2.50, 5.00...
// Recharge: 1.75, 3.50, 7.00...
function upgradePrice(basePrice, upgradeCount) {
  return basePrice * Math.pow(2, upgradeCount);
}

// ===============================
// 6 AM TAP RESET
// ===============================

function getTapCycleKey(now = new Date()) {
  const d = new Date(now);

  if (d.getHours() < DAY_START_HOUR) {
    d.setDate(d.getDate() - 1);
  }

  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function checkDailyReset() {
  const key = getTapCycleKey();

  if (st.tapResetKey !== key) {
    st.tapResetKey = key;
    st.tapEarnedToday = 0;

    // Daily task flags reset at 6 AM.
    st.tasks = {
      check: false,
      boost: false,
      ad: false,
      streak: false
    };

    save();
  }
}

// ===============================
// 5-HOUR ENERGY RESET
// ===============================

function checkEnergyReset() {
  if (!st.lastEnergyReset) {
    st.lastEnergyReset = Date.now();
    save();
    return;
  }

  const resetMs = currentEnergyResetMs();
  const elapsed = Date.now() - st.lastEnergyReset;

  if (elapsed >= resetMs) {
    const cycles = Math.floor(elapsed / resetMs);

    st.energy = st.maxEnergy;
    st.lastEnergyReset += cycles * resetMs;

    save();
  }
}

function secondsUntilEnergyReset() {
  const remaining =
    currentEnergyResetMs() -
    (Date.now() - st.lastEnergyReset);

  return Math.max(0, Math.ceil(remaining / 1000));
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return (
    String(h).padStart(2, "0") + ":" +
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0")
  );
}

// ===============================
// TAP REWARD
// ===============================

function addTapReward() {
  checkDailyReset();
  checkEnergyReset();

  if (st.tapEarnedToday >= TAP_DAILY_LIMIT) {
    toast("Today's $5 tap limit is reached");
    return false;
  }

  if (st.energy <= 0) {
    toast("Energy depleted");
    return false;
  }

  const reward = Math.min(
    currentTapReward(),
    TAP_DAILY_LIMIT - st.tapEarnedToday
  );

  st.energy -= 1;

  st.tapEarnedToday = +(
    st.tapEarnedToday + reward
  ).toFixed(2);

  st.balance = +(
    st.balance + reward
  ).toFixed(2);

  st.lifetime = +(
    st.lifetime + reward
  ).toFixed(2);

  save();
  return true;
}

// Other rewards are NOT counted against the $5 tap limit.
function addOtherReward(amount, reason) {
  st.balance = +(st.balance + amount).toFixed(2);
  st.lifetime = +(st.lifetime + amount).toFixed(2);

  st.history.unshift([
    reason,
    "+" + money(amount)
  ]);

  st.history = st.history.slice(0, 20);

  save();
}

// ===============================
// MONETAG ADS — ZONE 11556400
// ===============================

// Rewarded Interstitial — used for task rewards.
async function showRewardedInterstitial(label = "Reward") {
  if (typeof window.show_11556400 !== "function") {
    toast("Monetag is not ready");
    return false;
  }

  try {
    await window.show_11556400();
    toast(`${label} unlocked`);
    return true;
  } catch (error) {
    console.warn("Monetag Rewarded Interstitial:", error);
    toast("Ad unavailable - continuing");
    return false;
  }
}

// Rewarded Popup — used for upgrade purchases.
async function showRewardedPopup(label = "Upgrade") {
  if (typeof window.show_11556400 !== "function") {
    toast("Monetag is not ready");
    return false;
  }

  try {
    await window.show_11556400("pop");
    toast(`${label} unlocked`);
    return true;
  } catch (error) {
    console.warn("Monetag Rewarded Popup:", error);
    toast("Ad unavailable - continuing");
    return false;
  }
}

// In-App Interstitial — automatic Monetag placement.
function initializeInAppInterstitial() {
  if (typeof window.show_11556400 !== "function") {
    console.warn("Monetag SDK is not ready for In-App Interstitial");
    return;
  }

  try {
    window.show_11556400({
      type: "inApp",
      inAppSettings: {
        frequency: 1,
        capping: 0.1,
        interval: 60,
        timeout: 5,
        everyPage: false
      }
    });
  } catch (error) {
    console.warn("Monetag In-App Interstitial:", error);
  }
}

// ===============================
// HOME
// ===============================

async function home() {
  try {
    if (telegramInitData()) {
      await syncServerState();
    }
  } catch (error) {
    console.warn("Backend state sync failed:", error);
    toast(error.message);
  }

  checkDailyReset();
  checkEnergyReset();
  setNav("home");

  const tapLeft = Math.max(
    0,
    TAP_DAILY_LIMIT - st.tapEarnedToday
  );

  const energyPercent =
    (st.energy / st.maxEnergy) * 100;

  const resetSeconds =
    secondsUntilEnergyReset();

  screen.innerHTML = `
    <section class="hero">

      <div class="eyebrow">
        MY EARNINGS
      </div>

      <div class="balance">
        ${money(st.balance)}
      </div>

      <div class="sub">
       
      </div>

      <div class="stats">

        <div class="stat">
          <b>${money(st.tapEarnedToday)}</b>
          <small>TAP EARNED TODAY</small>
        </div>

        <div class="stat">
          <b>${money(tapLeft)}</b>
          <small>TAP LIMIT LEFT</small>
        </div>

      </div>

      <div class="small-note">
        Tap limit resets at 6:00 AM.
      </div>

    </section>

    <div class="meter">

      <div>
        <span>⚡ ENERGY</span>
        <b>${st.energy}/${st.maxEnergy}</b>
      </div>

      <div class="bar">
        <i style="width:${Math.max(
          0,
          Math.min(100, energyPercent)
        )}%"></i>
      </div>

      <div class="timer" id="energyTimer">
        Next reset: ${formatTime(resetSeconds)}
      </div>

      <div class="small-note">
        Current reset interval:
        ${formatResetTime(currentEnergyResetMs())}
      </div>

    </div>

    <div class="core" id="core">

      <strong>◆</strong>

      <b>EARN CORE</b>

      <small>
        ${money(currentTapReward())} per tap
      </small>

    </div>

    <div class="cards">

      <div class="card">
        <span class="label">LEVEL</span>
        <div class="value">${st.level}</div>
      </div>

      <div class="card">
        <span class="label">STREAK</span>
        <div class="value">🔥 ${st.streak}</div>
      </div>

      <div class="card full">
        <span class="label">
          LIFETIME EARNINGS
        </span>
        <div class="value">
          ${money(st.lifetime)}
        </div>
      </div>

    </div>

    <p class="note">
      Only tap earnings use the $5 daily limit.
      Other rewards are separate.
    </p>
  `;

  document.getElementById("core").onclick = async () => {
    const core = document.getElementById("core");

    if (!telegramInitData()) {
      toast("Open EarnForge inside Telegram");
      return;
    }

    core.disabled = true;

    try {
      const result = await serverTap();

      if (result.ok) {
        toast(`+${money(result.reward)}`);
        await home();
      }
    } catch (error) {
      console.error("Tap error:", error);
      toast(error.message || "Tap failed");
    } finally {
      core.disabled = false;
    }
  };
}

function formatResetTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

// ===============================
// TASKS
// ===============================

async function tasks() {
  setNav("tasks");

  try {
    await syncServerState();
  } catch (error) {
    console.error("Task state sync failed:", error);
    toast(error.message || "Could not load tasks");
    return;
  }

  const boostReady =
    !st.lastBoost ||
    Date.now() - st.lastBoost >= 15 * 60 * 1000;

  // Daily task status is loaded from the server. The local flags are
  // intentionally not trusted for eligibility.
  const status = await loadTaskStatus();

  screen.innerHTML = `
    <div class="title">Daily Tasks</div>

    ${task("🎁", "Daily Check-In", "Claim today's reward", 0.10, "check", status.check)}

    ${task(
      "⚡",
      "15-Minute Boost",
      boostReady ? "Reward is ready" : "Return after 15 minutes",
      0.15,
      "boost",
      !boostReady
    )}

    ${task(
      "📺",
      "Watch & Earn",
      "Watch a rewarded ad",
      0.05,
      "ad",
      false
    )}

    ${task("🔥", "Daily Streak", "Maintain your streak", 0.20, "streak", status.streak)}

    <p class="note">
      Tap earnings have the separate $5 daily tap limit.
    </p>
  `;

  document.querySelectorAll("[data-task]").forEach(button => {
    button.onclick = () => runTask(button.dataset.task);
  });
}

async function loadTaskStatus() {
  try {
    const data = await apiRequest("task-status", "POST");
    return {
      check: !!data.status?.check,
      streak: !!data.status?.streak
    };
  } catch (error) {
    console.error("Task status error:", error);
    return {
      check: false,
      streak: false
    };
  }
}

function task(
  icon,
  name,
  description,
  reward,
  key,
  disabled = false
) {
  const done = st.tasks[key];

  return `
    <div class="task">

      <div class="ico">
        ${icon}
      </div>

      <div class="main">
        <b>${name}</b>
        <small>${description}</small>
      </div>

      <span class="reward">
        ${done ? "✓" : money(reward)}
      </span>

      <button
        class="action"
        data-task="${key}"
        ${done || disabled ? "disabled" : ""}>
        ${
          done
            ? "DONE"
            : disabled
              ? "WAIT"
              : "CLAIM"
        }
      </button>

    </div>
  `;
}

async function runTask(key) {
  if (!telegramInitData()) {
    toast("Open EarnForge inside Telegram");
    return;
  }

  const buttons = [...document.querySelectorAll(`[data-task="${key}"]`)];
  buttons.forEach(b => b.disabled = true);

  try {
    // The ad is shown before the reward request. If the ad fails, do not
    // grant the reward. The backend remains authoritative for eligibility.
    if (key === "ad" || key === "check" || key === "boost" || key === "streak") {
      const adShown = await showRewardedInterstitial(
        key === "check" ? "Daily Check-In" :
        key === "boost" ? "Boost" :
        key === "streak" ? "Streak" :
        "Watch & Earn"
      );

      if (!adShown) {
        return;
      }
    }

    const result = await serverTask(key);

    if (result.ok) {
      toast(`+${money(result.reward)} virtual`);
      await tasks();
    }
  } catch (error) {
    console.error("Task error:", error);
    toast(error.message || "Task unavailable");
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
}

// ===============================
// UPGRADES
// ===============================

function upgrades() {
  setNav("upgrade");

  const powerCost =
    upgradePrice(1.50, st.upgrades.power);

  const energyCost =
    upgradePrice(1.25, st.upgrades.energy);

  const rechargeCost =
    upgradePrice(1.75, st.upgrades.recharge);

  const nextEnergy =
    nextEnergyGain();

  const resetMs =
    currentEnergyResetMs();

  screen.innerHTML = `
    <div class="title">
      Upgrades
    </div>

    <p class="note">
    
    </p>

    <div class="upgrade">

      <div class="ico">⚡</div>

      <div class="main">
        <b>Earning Power</b>
        <small>
          Level ${st.upgrades.power}
        </small>
        <small>
          Current: ${money(currentTapReward())}/tap
        </small>
        <small>
          Next: +$0.01/tap
        </small>
      </div>

      <div>
        <span class="reward">
          ${money(powerCost)}
        </span>

        <button
          class="action"
          data-up="power"
          data-cost="${powerCost}">
          UPGRADE
        </button>
      </div>

    </div>

    <div class="upgrade">

      <div class="ico">🔋</div>

      <div class="main">
        <b>Energy Capacity</b>
        <small>
          Level ${st.upgrades.energy}
        </small>
        <small>
          Current: ${st.maxEnergy}
        </small>
        <small>
          Next: +${nextEnergy}
        </small>
      </div>

      <div>
        <span class="reward">
          ${money(energyCost)}
        </span>

        <button
          class="action"
          data-up="energy"
          data-cost="${energyCost}">
          UPGRADE
        </button>
      </div>

    </div>

    <div class="upgrade">

      <div class="ico">♻️</div>

      <div class="main">
        <b>Recharge Speed</b>
        <small>
          Level ${st.upgrades.recharge}
        </small>
        <small>
          Current: ${formatResetTime(resetMs)}
        </small>
        <small>
          Next: −10 minutes
        </small>
      </div>

      <div>
        <span class="reward">
          ${money(rechargeCost)}
        </span>

        <button
          class="action"
          data-up="recharge"
          data-cost="${rechargeCost}">
          UPGRADE
        </button>
      </div>

    </div>

    <div class="card full">

      <span class="label">
        UPGRADE RULES
      </span>

      <p class="note">
        Power: +$0.01 per upgrade.<br>
        Energy: +5 per upgrade.<br>
        Upgrade price: doubles after every purchase.<br>
        Recharge: −10 minutes per upgrade.
      </p>

    </div>
  `;

  document
    .querySelectorAll("[data-up]")
    .forEach(button => {
      button.onclick = () =>
        buyUpgrade(
          button.dataset.up,
          Number(button.dataset.cost)
        );
    });
}

async function buyUpgrade(key, cost) {
  if (!telegramInitData()) {
    toast("Open EarnForge inside Telegram");
    return;
  }

  // The displayed cost is only UI. The server recalculates the
  // real price from the stored upgrade level.
  const button = document.querySelector(`[data-up="${key}"]`);
  if (button) button.disabled = true;

  try {
    // Keep your requested Monetag Rewarded Popup before upgrades.
    const adWatched = await showRewardedPopup("Upgrade");
    if (!adWatched) {
      if (button) button.disabled = false;
      return;
    }

    const data = await serverUpgrade(key);

    const type = data.upgrade?.type;
    const level = Number(data.upgrade?.level || 0);
    const actualCost = Number(data.upgrade?.cost || 0);

    if (type === "power") {
      toast(`Earning Power: Level ${level} • ${money(currentTapReward())}/tap`);
    } else if (type === "energy") {
      toast(`Energy capacity: ${st.maxEnergy}`);
    } else if (type === "recharge") {
      toast(`Reset: ${formatResetTime(currentEnergyResetMs())}`);
    } else {
      toast(`Upgrade purchased for ${money(actualCost)}`);
    }

    await home();
    upgrades();
  } catch (error) {
    console.error("Upgrade error:", error);
    toast(error.message || "Upgrade failed");
  } finally {
    const freshButton = document.querySelector(`[data-up="${key}"]`);
    if (freshButton) freshButton.disabled = false;
  }
}

// ===============================
// RANK
// ===============================

// ===============================
// PROFILE
// ===============================

async function withdraw() {
  setNav("withdraw");

  try {
    await syncServerState();
  } catch (error) {
    console.error("Withdrawal state sync failed:", error);
    toast(error.message || "Could not load withdrawal");
    return;
  }

  const minimum = 100;
  const progress = Math.max(
    0,
    Math.min(100, (st.balance / minimum) * 100)
  );
  const remaining = Math.max(0, minimum - st.balance);

  let request = null;

  try {
    const status = await loadWithdrawalStatus();
    request = status.request || null;
  } catch (error) {
    console.warn("Withdrawal status unavailable:", error);
  }

  const statusText =
    request?.status === "processing"
      ? "REQUEST PROCESSING"
      : request?.status === "demo_completed"
        ? "REQUEST COMPLETED"
        : null;

  screen.innerHTML = `
    <div class="title">Withdrawal</div>

    <div class="card full">
      <span class="label">WITHDRAWAL PROGRESS</span>

      <div class="value">
        ${money(st.balance)} / ${money(minimum)}
      </div>

      <div class="meter" style="margin-top:14px">
        <div>
          <span>PROGRESS</span>
          <b>${progress.toFixed(0)}%</b>
        </div>

        <div class="bar">
          <i style="width:${progress}%"></i>
        </div>
      </div>

      ${
        remaining > 0
          ? `<p class="note">
              ${money(remaining)} more in earnings is needed
              to reach the ${money(minimum)} threshold.
            </p>`
          : `<p class="note success">
              Your balance has reached the withdrawal threshold.
            </p>`
      }
    </div>

    <div class="card full">
      <span class="label">MINIMUM WITHDRAWAL</span>
      <div class="value">${money(minimum)}</div>

      ${
        statusText
          ? `<div class="row" style="margin-top:14px">
              <div class="main">
                <b>${statusText}</b>
                <small>
                  Submitted ${new Date(request.created_at).toLocaleString()}
                </small>
              </div>
              <strong></strong>
            </div>`
          : `<button
              class="action"
              id="withdrawBtn"
              style="width:100%;margin-top:14px"
              ${st.balance < minimum ? "disabled" : ""}>
              ${
                st.balance < minimum
                  ? "REACH $100 TO WITHDRAW"
                  : "REQUEST WITHDRAWAL"
              }
            </button>`
      }

      <p class="note">
      
      </p>
    </div>
  `;

  document.getElementById("withdrawBtn")?.addEventListener(
    "click",
    async () => {
      const button = document.getElementById("withdrawBtn");
      if (button) button.disabled = true;

      try {
        const result = await serverWithdrawal();
        const r = result.request;

        toast(
          result.already_processing
            ? "Withdrawal is already processing"
            : "Withdrawal request submitted"
        );

        await withdraw();
      } catch (error) {
        console.error("Withdrawal error:", error);
        toast(error.message || "Withdrawal unavailable");
        if (button) button.disabled = false;
      }
    }
  );
}

function profile() {
  setNav("profile");

  const otherRewards = Math.max(
    0,
    st.balance - st.tapEarnedToday
  );

  screen.innerHTML = `
    <div class="profile">

      <div class="avatar">
        EF
      </div>

      <h2>
        EarnForge Player
      </h2>

      <p class="note">
        Telegram account connected
      </p>

    </div>

    <div class="title">
      Earnings
    </div>

    <div class="row">
      <div class="main">
        <b>Tap Earnings Today</b>
      </div>
      <strong>
        ${money(st.tapEarnedToday)}
      </strong>
    </div>

    <div class="row">
      <div class="main">
        <b>Other Rewards</b>
      </div>
      <strong>
        ${money(otherRewards)}
      </strong>
    </div>

    <div class="row">
      <div class="main">
        <b>Lifetime</b>
      </div>
      <strong>
        ${money(st.lifetime)}
      </strong>
    </div>

    <div class="card">
      <span class="label">
        REWARDS
      </span>

      <div class="value">
        ${money(st.balance)}
      </div>

      <p class="note">
      
      </p>
    </div>
  `;
}

// ===============================
// NAVIGATION
// ===============================

function setNav(name) {
  navButtons.forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.s === name
    );
  });
}

function go(name) {
  const screens = {
    home,
    tasks,
    upgrade: upgrades,
    withdraw,
    profile
  };

  if (screens[name]) {
    screens[name]();
  }
}

navButtons.forEach(button => {
  button.onclick = () =>
    go(button.dataset.s);
});

document
  .getElementById("settings")
  ?.addEventListener(
    "click",
    () => toast("Settings coming soon")
  );

// ===============================
// TIMER LOOP
// ===============================

function updateTimers() {
  checkDailyReset();
  checkEnergyReset();

  const timer =
    document.getElementById("energyTimer");

  if (timer) {
    timer.textContent =
      "Next reset: " +
      formatTime(
        secondsUntilEnergyReset()
      );
  }

  setTimeout(updateTimers, 1000);
}

// ===============================
// START
// ===============================

checkDailyReset();
checkEnergyReset();
home();
updateTimers();

// Start Monetag In-App Interstitial.
initializeInAppInterstitial();
