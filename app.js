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

  level: 12,
  streak: 12,
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
// MONETAG REWARDED INTERSTITIAL
// ===============================

async function showRewardedAd() {
  if (typeof window.show_11333168 !== "function") {
    toast("Monetag ad is not ready");
    return false;
  }

  try {
    await window.show_11333168();
    return true;
  } catch (error) {
    console.warn("Monetag error:", error);
    return false;
  }
}

async function adBeforeAction(label) {
  toast("Ad loading...");
  const shown = await showRewardedAd();

  if (shown) {
    toast(`${label} unlocked`);
  } else {
    toast("Ad unavailable - continuing");
  }

  return shown;
}

// ===============================
// HOME
// ===============================

function home() {
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
        VIRTUAL EARNINGS • NO CASH VALUE
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

  document.getElementById("core").onclick = () => {
    if (addTapReward()) {
      home();
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

function tasks() {
  checkDailyReset();
  checkEnergyReset();
  setNav("tasks");

  const boostReady =
    Date.now() - st.lastBoost >= 15 * 60 * 1000;

  screen.innerHTML = `
    <div class="title">
      Daily Tasks
    </div>

    ${task(
      "🎁",
      "Daily Check-In",
      "Claim today's reward",
      0.10,
      "check"
    )}

    ${task(
      "⚡",
      "15-Minute Boost",
      boostReady
        ? "Reward is ready"
        : "Return after 15 minutes",
      0.15,
      "boost",
      !boostReady
    )}

    ${task(
      "📺",
      "Watch & Earn",
      "Watch a rewarded ad",
      0.05,
      "ad"
    )}

    ${task(
      "🔥",
      "Daily Streak",
      "Maintain your streak",
      0.20,
      "streak"
    )}

    <p class="note">
      An ad is shown before each task reward. These rewards do not reduce the $5 tap allowance.
    </p>
  `;

  document
    .querySelectorAll("[data-task]")
    .forEach(button => {
      button.onclick = () =>
        runTask(button.dataset.task);
    });
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
  if (key === "boost") {
    if (
      Date.now() - st.lastBoost <
      15 * 60 * 1000
    ) {
      toast("Boost not ready");
      return;
    }

    await adBeforeAction("Boost");

    addOtherReward(
      0.15,
      "15-minute boost"
    );

    st.lastBoost = Date.now();
    st.tasks.boost = true;

    save();
    tasks();
    return;
  }

  if (key === "ad") {
    await adBeforeAction("Watch & Earn");

    addOtherReward(
      0.05,
      "Ad reward"
    );

    st.tasks.ad = true;

    save();
    tasks();
    return;
  }

  const rewards = {
    check: 0.10,
    streak: 0.20
  };

  await adBeforeAction(
    key === "check"
      ? "Daily Check-In"
      : "Streak"
  );

  addOtherReward(
    rewards[key],
    key === "check"
      ? "Daily check-in"
      : "Streak bonus"
  );

  st.tasks[key] = true;

  save();
  tasks();
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
      An ad is shown before each upgrade purchase.
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
  if (st.balance < cost) {
    toast("Not enough balance");
    return;
  }

  if (
    key === "recharge" &&
    currentEnergyResetMs() <= MIN_ENERGY_RESET_MS
  ) {
    toast("Minimum recharge time reached");
    return;
  }

  await adBeforeAction("Upgrade");

  st.balance = +(st.balance - cost).toFixed(2);

  if (key === "power") {
    st.upgrades.power += 1;
    toast(`Tap power: ${money(currentTapReward())}`);
  }

  if (key === "energy") {
    st.upgrades.energy += 1;
    st.maxEnergy += nextEnergyGain();
    st.energy = Math.min(
      st.maxEnergy,
      st.energy + ENERGY_UPGRADE_GAIN
    );
    toast(`Energy capacity: ${st.maxEnergy}`);
  }

  if (key === "recharge") {
    st.upgrades.recharge += 1;
    toast(`Reset: ${formatResetTime(currentEnergyResetMs())}`);
  }

  save();
  upgrades();
}

// ===============================
// RANK
// ===============================

// ===============================
// PROFILE
// ===============================

function withdraw() {
  setNav("withdraw");

  const minimum = 100;
  const progress = Math.max(
    0,
    Math.min(100, (st.balance / minimum) * 100)
  );
  const remaining = Math.max(
    0,
    minimum - st.balance
  );

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
              You need ${money(remaining)} more in your virtual balance
              to reach the ${money(minimum)} minimum.
            </p>`
          : `<p class="note success">
              Your virtual balance has reached the withdrawal threshold.
            </p>`
      }
    </div>

    <div class="card full">
      <span class="label">MINIMUM WITHDRAWAL</span>
      <div class="value">${money(minimum)}</div>

      <button
        class="action"
        id="withdrawBtn"
        style="width:100%;margin-top:14px"
        ${st.balance < minimum ? "disabled" : ""}>
        ${
          st.balance < minimum
            ? "REACH $100 TO WITHDRAW"
            : "REQUEST WITHDRAWAL"
        }
      </button>

      <p class="note">
        This prototype displays virtual game earnings only.
        No real-money withdrawal or payment is processed by this demo.
      </p>
    </div>
  `;

  document.getElementById("withdrawBtn")?.addEventListener(
    "click",
    () => {
      if (st.balance < minimum) {
        toast("Minimum withdrawal is $100");
        return;
      }

      toast("Demo withdrawal request submitted");
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
        Current values are virtual game values.
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
