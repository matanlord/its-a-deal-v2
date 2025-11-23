// ITS A DEAL v8 – frontend logic
// - no user switching
// - per-user password
// - one account per device (client + server enforcement)
// - deviceId sent to server so admin can see which user שייך לאיזה מכשיר
// - PDF contract per deal AFTER ACCEPTED
// - break deal option only for the sender (fromId) on accepted deals
(() => {
  const DEVICE_LOCK_KEY = "its_a_deal_v11_device_locked";
  const DEVICE_NAME_KEY = "its_a_deal_v11_device_name";
  const DEVICE_ID_KEY = "its_a_deal_v11_device_id";

  let socket = null;
  let currentUserId = null;
  let users = [];
  let trades = [];
  let brokenTickerItems = [];
  let tickerIndex = 0;
  let tickerTimer = null;

  window.addEventListener("load", () => {
    // ----- deviceId generation -----
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId =
        "dev_" +
        Math.random().toString(36).slice(2) +
        Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }

    const registerOverlay = document.getElementById("registerOverlay");
    const registerNameInput = document.getElementById("registerName");
    const registerPasswordInput = document.getElementById("registerPassword");
    const registerBtn = document.getElementById("registerBtn");
    const registerError = document.getElementById("registerError");
    const overlayText = document.getElementById("overlayText");

    const dealTargetSelect = document.getElementById("dealTargetSelect");
    const sendDealBtn = document.getElementById("sendDealBtn");
    const createDealMessage = document.getElementById("createDealMessage");

    async function checkDeviceLockWithServer(deviceId) {
      try {
        const res = await fetch("/api/device-status?deviceId=" + encodeURIComponent(deviceId));
        if (!res.ok) return;
        const data = await res.json();
        const user = data.user;

        const locked = localStorage.getItem(DEVICE_LOCK_KEY) === "1";
        const lockedName = localStorage.getItem(DEVICE_NAME_KEY) || "";

        if (!user) {
          // אין משתמש בשרת למכשיר הזה – מאפסים את הנעילה בצד לקוח
          localStorage.removeItem(DEVICE_LOCK_KEY);
          localStorage.removeItem(DEVICE_NAME_KEY);

          registerNameInput.readOnly = false;
          registerNameInput.classList.remove("readonly");
          overlayText.textContent =
            "פעם ראשונה אתה בוחר שם + סיסמה. אחר כך אתה מתחבר עם אותו שם וסיסמה. במכשיר הזה אפשר ליצור רק משתמש אחד.";
          if (!lockedName) {
            registerNameInput.value = "";
          }
        } else {
          // יש משתמש ל-deviceId – מסנכרנים את השם
          if (!locked || lockedName !== user.name) {
            localStorage.setItem(DEVICE_LOCK_KEY, "1");
            localStorage.setItem(DEVICE_NAME_KEY, user.name);
            registerNameInput.value = user.name;
            registerNameInput.readOnly = true;
            registerNameInput.classList.add("readonly");
            overlayText.textContent =
              "במכשיר הזה כבר נוצר משתמש בשם: " +
              user.name +
              ". אתה יכול להתחבר רק אליו עם הסיסמה שבחרת.";
          }
        }
      } catch (e) {
        console.error("device-status check failed", e);
      }
    }

    // check device lock (only one user can be created on this device)
    const locked = localStorage.getItem(DEVICE_LOCK_KEY) === "1";
    const lockedName = localStorage.getItem(DEVICE_NAME_KEY) || "";

    registerOverlay.style.display = "flex";

    if (locked && lockedName) {
      // נבדוק גם מול השרת שהנעילה עדיין רלוונטית
      checkDeviceLockWithServer(deviceId);

      // במכשיר הזה כבר נוצר משתמש – אפשר רק להתחבר אליו
      registerNameInput.value = lockedName;
      registerNameInput.readOnly = true;
      registerNameInput.classList.add("readonly");
      overlayText.textContent =
        "במכשיר הזה כבר נוצר משתמש בשם: " +
        lockedName +
        ". אתה יכול להתחבר רק אליו עם הסיסמה שבחרת.";
    }

    registerBtn.addEventListener("click", async () => {
      registerError.textContent = "";
      const name = (registerNameInput.value || "").trim();
      const password = registerPasswordInput.value;

      if (!name) {
        registerError.textContent = "צריך לכתוב שם";
        return;
      }

      // אם המכשיר נעול לשם מסוים – לא מאפשרים להתחבר בשם אחר
      if (locked && lockedName && name !== lockedName) {
        registerError.textContent =
          "במכשיר הזה אפשר להתחבר רק למשתמש: " + lockedName;
        return;
      }

      if (!password) {
        registerError.textContent = "צריך לבחור סיסמה";
        return;
      }
      if (password.length < 6) {
        registerError.textContent = "הסיסמה חייבת להיות לפחות 6 תווים";
        return;
      }

      try {
        const res = await fetch("/api/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password, deviceId })
        });
        const data = await res.json();
        if (!res.ok) {
          registerError.textContent = data.error || "שגיאה בהתחברות";
          return;
        }
        currentUserId = data.id;

        // אם זה משתמש חדש – נועל את המכשיר לשם הזה
        if (data.isNew) {
          localStorage.setItem(DEVICE_LOCK_KEY, "1");
          localStorage.setItem(DEVICE_NAME_KEY, name);
        }

        registerOverlay.style.display = "none";
        bootAndConnect();
      } catch (err) {
        console.error(err);
        registerError.textContent = "שגיאת רשת";
      }
    });

    sendDealBtn.addEventListener("click", async () => {
      createDealMessage.textContent = "";
      createDealMessage.className = "status-message";

      const targetId = dealTargetSelect.value;
      const giveText = document.getElementById("giveText").value.trim();
      const takeText = document.getElementById("takeText").value.trim();

      if (!currentUserId) {
        createDealMessage.textContent = "צריך להתחבר קודם";
        createDealMessage.classList.add("error");
        return;
      }
      if (!targetId) {
        createDealMessage.textContent = "בחר למי אתה מציע דיל";
        createDealMessage.classList.add("error");
        return;
      }
      if (targetId === currentUserId) {
        createDealMessage.textContent = "אי אפשר לשלוח דיל לעצמך 😉";
        createDealMessage.classList.add("error");
        return;
      }
      if (!giveText || !takeText) {
        createDealMessage.textContent = "צריך גם מה אתה נותן וגם מה אתה רוצה";
        createDealMessage.classList.add("error");
        return;
      }

      try {
        const res = await fetch("/api/trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromId: currentUserId,
            toId: targetId,
            give: giveText,
            take: takeText
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          createDealMessage.textContent = data.error || "שגיאה בשליחת הדיל";
          createDealMessage.classList.add("error");
          return;
        }
        document.getElementById("giveText").value = "";
        document.getElementById("takeText").value = "";
        createDealMessage.textContent = "הדיל נשלח ✅ (החוזה יהיה זמין כ-PDF אחרי שהדיל יאושר)";
        createDealMessage.classList.add("ok");
      } catch (err) {
        console.error(err);
        createDealMessage.textContent = "שגיאת רשת";
        createDealMessage.classList.add("error");
      }
    });

    async function bootAndConnect() {
      try {
        const res = await fetch("/api/boot");
        const data = await res.json();
        users = data.users || [];
        trades = data.trades || [];
        syncUsersSelects();
        renderCurrentUserInfo();
        renderUsersList();
        renderInbox();
        renderApprovedDeals();
        renderScoreboard();
      } catch (err) {
        console.error("boot error", err);
      }

      socket = io();

      socket.on("state:update", (data) => {
        users = data.users || [];
        trades = data.trades || [];
        syncUsersSelects();
        renderCurrentUserInfo();
        renderUsersList();
        renderInbox();
        renderApprovedDeals();
        renderScoreboard();
      });

      socket.on("ticker:update", (list) => {
        if (!Array.isArray(list)) {
          brokenTickerItems = [];
        } else {
          brokenTickerItems = list.slice(0, 3);
        }
        tickerIndex = 0;
        updateTickerDisplay();
      });

      setupTickerRotation();

      // ping server so lastSeenAt is updated (for admin "online" view)
      setInterval(() => {
        if (socket && currentUserId) {
          socket.emit("pong:client-alive", currentUserId);
        }
      }, 15000);
    }


function computeTickerText(t) {
  const fromName = getUserName(t.fromId) || "צד א'";
  const toName = getUserName(t.toId) || "צד ב'";
  const timeStr = t.decidedAt ? new Date(t.decidedAt).toLocaleString("he-IL") : "";
  return `[${timeStr}] דיל נשבר בין ${fromName} ל-${toName} | ${t.give} ↔ ${t.take}`;
}

function updateTickerDisplay() {
  const bar = document.getElementById("newsTicker");
  if (!bar) return;
  if (!brokenTickerItems.length) {
    bar.innerHTML = "";
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";
  const t = brokenTickerItems[tickerIndex % brokenTickerItems.length];
  const text = computeTickerText(t);
  bar.innerHTML = `<div class="tick">${text}</div>`;
}

function setupTickerRotation() {
  if (tickerTimer) {
    clearInterval(tickerTimer);
  }
  tickerTimer = setInterval(() => {
    if (!brokenTickerItems.length) return;
    tickerIndex = (tickerIndex + 1) % brokenTickerItems.length;
    updateTickerDisplay();
  }, 10 * 60 * 1000); // כל 10 דקות מחליפים דיל בטיקר
}

    function syncUsersSelects() {
      const dealTargetSelect = document.getElementById("dealTargetSelect");
      dealTargetSelect.innerHTML = "";

      users.forEach((u) => {
        if (u.id === currentUserId) return; // don't show myself as target
        const opt2 = document.createElement("option");
        opt2.value = u.id;
        opt2.textContent = u.name;
        dealTargetSelect.appendChild(opt2);
      });
    }

    function getUserName(id) {
      const u = users.find((x) => x.id === id);
      return u ? u.name : "";
    }

    function renderCurrentUserInfo() {
      const currentUserInfo = document.getElementById("currentUserInfo");
      const name = getUserName(currentUserId);
      currentUserInfo.textContent = name ? "אתה מחובר בתור: " + name : "";
    }

    function renderUsersList() {
      const ul = document.getElementById("usersListNames");
      if (!ul) return;

      ul.innerHTML = "";

      if (!users || users.length === 0) {
        const li = document.createElement("li");
        li.textContent = "אין עדיין משתמשים רשומים.";
        li.style.opacity = "0.8";
        ul.appendChild(li);
        return;
      }

      users
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "he"))
        .forEach((u) => {
          const li = document.createElement("li");
          li.textContent = u.name + (u.id === currentUserId ? " (אתה)" : "");
          ul.appendChild(li);
        });
    }

    function openPdf(tradeId) {
      window.open("/api/trades/" + tradeId + "/pdf", "_blank");
    }

    function renderInbox() {
      const inboxContainer = document.getElementById("inboxContainer");
      inboxContainer.innerHTML = "";

      if (!currentUserId) return;

      const incoming = trades.filter(
        (t) => t.toId === currentUserId && t.status === "OPEN"
      );

      if (incoming.length === 0) {
        const p = document.createElement("p");
        p.textContent = "אין דילים ממתינים כרגע 🙌";
        p.style.fontSize = "13px";
        p.style.opacity = "0.8";
        inboxContainer.appendChild(p);
        return;
      }

      incoming
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .forEach((t) => {
          const item = document.createElement("div");
          item.className = "deal-item";

          const header = document.createElement("div");
          header.className = "deal-header";
          header.innerHTML =
            "<strong>" + getUserName(t.fromId) + "</strong> הציע לך דיל";

          const body = document.createElement("div");
          body.className = "deal-body";

          const pGive = document.createElement("p");
          pGive.innerHTML = "<strong>מה הוא נותן:</strong> " + t.give;

          const pTake = document.createElement("p");
          pTake.innerHTML = "<strong>מה הוא מבקש:</strong> " + t.take;

          body.appendChild(pGive);
          body.appendChild(pTake);

          const actions = document.createElement("div");
          actions.className = "deal-actions";

          // שים לב: כאן אין PDF – רק אחרי שהדיל מאושר
          const btnAccept = document.createElement("button");
          btnAccept.className = "btn small accept";
          btnAccept.textContent = "קבל ✅";
          btnAccept.addEventListener("click", () => {
            updateTrade(t.id, "accept");
          });

          const btnReject = document.createElement("button");
          btnReject.className = "btn small reject";
          btnReject.textContent = "דחה ❌";
          btnReject.addEventListener("click", () => {
            updateTrade(t.id, "decline");
          });

          actions.appendChild(btnAccept);
          actions.appendChild(btnReject);

          item.appendChild(header);
          item.appendChild(body);
          item.appendChild(actions);

          inboxContainer.appendChild(item);
        });
    }

    function renderApprovedDeals() {
      const container = document.getElementById("approvedDealsContainer");
      container.innerHTML = "";

      if (!currentUserId) return;

      const mine = trades.filter(
        (t) =>
          t.status === "ACCEPTED" &&
          (t.fromId === currentUserId || t.toId === currentUserId)
      );

      if (mine.length === 0) {
        const p = document.createElement("p");
        p.textContent = "אין דילים מאושרים כרגע.";
        p.style.fontSize = "13px";
        p.style.opacity = "0.8";
        container.appendChild(p);
        return;
      }

      mine
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .forEach((t) => {
          const item = document.createElement("div");
          item.className = "deal-item";

          const otherId = t.fromId === currentUserId ? t.toId : t.fromId;
          const otherName = getUserName(otherId);

          const header = document.createElement("div");
          header.className = "deal-header";
          header.innerHTML =
            "דיל מאושר בינך לבין <strong>" + otherName + "</strong>";

          const body = document.createElement("div");
          body.className = "deal-body";

          const pGive = document.createElement("p");
          pGive.innerHTML =
            "<strong>מה נותן " + getUserName(t.fromId) + ":</strong> " + t.give;

          const pTake = document.createElement("p");
          pTake.innerHTML =
            "<strong>מה נותן " + getUserName(t.toId) + ":</strong> " + t.take;

          body.appendChild(pGive);
          body.appendChild(pTake);

          const actions = document.createElement("div");
          actions.className = "deal-actions";

          const btnPdf = document.createElement("button");
          btnPdf.className = "btn small";
          btnPdf.textContent = "📄 חוזה PDF";
          btnPdf.addEventListener("click", () => openPdf(t.id));
          actions.appendChild(btnPdf);

          // פעולות צד א' בלבד
          if (currentUserId === t.fromId) {
            const btnDone = document.createElement("button");
            btnDone.className = "btn small accept";
            btnDone.textContent = "הדיל בוצע";
            btnDone.addEventListener("click", () => {
              if (confirm("האם הדיל בוצע במלואו ואינך חייב יותר?")) {
                updateTrade(t.id, "done");
              }
            });
            actions.appendChild(btnDone);

            const btnBreak = document.createElement("button");
            btnBreak.className = "btn small reject";
            btnBreak.textContent = "שבירת דיל";
            btnBreak.addEventListener("click", () => {
              if (confirm("אתה בטוח שהדיל נשבר ביניכם?")) {
                updateTrade(t.id, "break");
              }
            });
            actions.appendChild(btnBreak);
          }

          item.appendChild(header);
          item.appendChild(body);
          item.appendChild(actions);

          container.appendChild(item);
        });
    }

    async function updateTrade(tradeId, action) {
      try {
        const body = { action };
        if (action === "break" || action === "done") {
          body.requesterId = currentUserId;
        }
        const res = await fetch("/api/trades/" + tradeId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          console.error("update trade failed");
        }
      } catch (err) {
        console.error(err);
      }
    }

    function renderScoreboard() {
      const tbody = document.getElementById("scoreTableBody");
      tbody.innerHTML = "";

      const counts = {};
      users.forEach((u) => {
        counts[u.id] = {
          name: u.name,
          credits: 0, // owed to them
          debts: 0 // they owe others
        };
      });

      // רק דילים מאושרים (לא שבורים) נספרים
      trades
        .filter((t) => t.status === "ACCEPTED")
        .forEach((t) => {
          if (counts[t.fromId]) counts[t.fromId].credits += 1;
          if (counts[t.toId]) counts[t.toId].debts += 1;
        });

      const arr = Object.keys(counts).map((id) => ({
        id,
        name: counts[id].name,
        credits: counts[id].credits,
        debts: counts[id].debts,
        net: counts[id].credits - counts[id].debts
      }));

      arr.sort((a, b) => {
        if (b.credits !== a.credits) return b.credits - a.credits;
        return b.net - a.net;
      });

      arr.forEach((row, index) => {
        const tr = document.createElement("tr");

        const tdTitle = document.createElement("td");
        tdTitle.textContent = index === 0 && row.credits > 0 ? "OVERLORD" : "";
        tr.appendChild(tdTitle);

        const tdName = document.createElement("td");
        tdName.textContent = row.name;

        const tdCredits = document.createElement("td");
        tdCredits.textContent = row.credits;

        const tdDebts = document.createElement("td");
        tdDebts.textContent = row.debts;

        const tdNet = document.createElement("td");
        tdNet.textContent = row.net;
        if (row.net > 0) tdNet.classList.add("score-positive");
        if (row.net < 0) tdNet.classList.add("score-negative");

        tr.appendChild(tdName);
        tr.appendChild(tdCredits);
        tr.appendChild(tdDebts);
        tr.appendChild(tdNet);

        tbody.appendChild(tr);
      });
    }
  });
})();
