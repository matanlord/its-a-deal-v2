// ITS A DEAL v2 – לוגיקת פרונט חדשה
(() => {
  const STORAGE_KEY = "its_a_deal_v2_user_id";

  let socket = null;
  let currentUserId = null;
  let users = [];
  let trades = [];

  window.addEventListener("load", () => {
    const registerOverlay = document.getElementById("registerOverlay");
    const registerNameInput = document.getElementById("registerName");
    const registerBtn = document.getElementById("registerBtn");
    const registerError = document.getElementById("registerError");

    const currentUserSelect = document.getElementById("currentUserSelect");
    const currentUserInfo = document.getElementById("currentUserInfo");
    const dealTargetSelect = document.getElementById("dealTargetSelect");
    const sendDealBtn = document.getElementById("sendDealBtn");
    const createDealMessage = document.getElementById("createDealMessage");

    const savedId = localStorage.getItem(STORAGE_KEY);
    if (!savedId) {
      registerOverlay.style.display = "flex";
    } else {
      currentUserId = savedId;
      registerOverlay.style.display = "none";
      bootAndConnect();
    }

    registerBtn.addEventListener("click", async () => {
      registerError.textContent = "";
      const name = (registerNameInput.value || "").trim();
      if (!name) {
        registerError.textContent = "צריך לכתוב שם";
        return;
      }
      try {
        const res = await fetch("/api/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          registerError.textContent = data.error || "שגיאה ביצירת משתמש";
          return;
        }
        const user = await res.json();
        currentUserId = user.id;
        localStorage.setItem(STORAGE_KEY, currentUserId);
        registerOverlay.style.display = "none";
        bootAndConnect();
      } catch (err) {
        console.error(err);
        registerError.textContent = "שגיאת רשת";
      }
    });

    currentUserSelect.addEventListener("change", () => {
      currentUserId = currentUserSelect.value || null;
      if (currentUserId) {
        localStorage.setItem(STORAGE_KEY, currentUserId);
      }
      renderCurrentUserInfo();
      renderInbox();
      renderScoreboard();
    });

    sendDealBtn.addEventListener("click", async () => {
      createDealMessage.textContent = "";
      createDealMessage.className = "status-message";

      const targetId = dealTargetSelect.value;
      const giveText = document.getElementById("giveText").value.trim();
      const takeText = document.getElementById("takeText").value.trim();

      if (!currentUserId) {
        createDealMessage.textContent = "צריך לבחור משתמש קודם";
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
        createDealMessage.textContent = "הדיל נשלח ✅";
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
        renderInbox();
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
        renderInbox();
        renderScoreboard();
      });

      // פינג לשרת כדי לעדכן lastSeenAt (לוגיקה שונה מהגרסה הישנה)
      setInterval(() => {
        if (socket && currentUserId) {
          socket.emit("pong:client-alive", currentUserId);
        }
      }, 15000);
    }

    function syncUsersSelects() {
      const currentUserSelect = document.getElementById("currentUserSelect");
      const dealTargetSelect = document.getElementById("dealTargetSelect");
      currentUserSelect.innerHTML = "";
      dealTargetSelect.innerHTML = "";

      users.forEach((u) => {
        const opt1 = document.createElement("option");
        opt1.value = u.id;
        opt1.textContent = u.name;
        currentUserSelect.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = u.id;
        opt2.textContent = u.name;
        dealTargetSelect.appendChild(opt2);
      });

      if (!users.find((u) => u.id === currentUserId) && users.length > 0) {
        currentUserId = users[0].id;
        localStorage.setItem(STORAGE_KEY, currentUserId);
      }

      if (currentUserId) {
        currentUserSelect.value = currentUserId;
      }
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

    async function updateTrade(tradeId, action) {
      try {
        const res = await fetch("/api/trades/" + tradeId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
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
          credits: 0, // כמה חייבים לו
          debts: 0 // כמה הוא חייב לאחרים
        };
      });

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

      arr.forEach((row) => {
        const tr = document.createElement("tr");

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
