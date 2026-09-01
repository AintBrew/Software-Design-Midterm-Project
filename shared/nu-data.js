/* ============================================================
   NU Fairview LRC Study Area Online Booking System
   shared/nu-data.js

   Front end only. There is no database yet, so accounts are
   hardcoded here and study areas / reservations are seeded into
   localStorage the first time a page loads.
   ============================================================ */

var NU = (function () {

  var ACCOUNT_KEY = "nufv_accounts";
  var SESSION_KEY = "nufv_session";
  var BOOKING_KEY = "nufv_reservations";
  var SEEDED_KEY  = "nufv_seeded_on";

  /* ---- Hardcoded accounts (no database yet) ---------------- */
  var BUILT_IN = [
    {
      username: "user",
      password: "12345678",
      role: "student",
      name: "Gabe M. Cruz",
      studentNo: "19-12345",
      program: "BS Computer Engineering",
      email: "cruzgm@students.nu-fairview.edu.ph"
    },
    {
      // LRC staff and system administrator share one account.
      username: "admin",
      password: "12345678",
      role: "admin",
      name: "Ma. Teresa Lim",
      studentNo: "LRC-0042",
      program: "LRC Supervisor / Administrator",
      email: "limmt@nu-fairview.edu.ph"
    }
  ];

  /* ---- Study areas (from the proposal wireframes) ---------- */
  var AREAS = [
    {
      id: "A1", name: "Individual Study Pod A1", type: "Individual",
      capacity: 2, image: "room-pod", status: "available",
      hours: "9:00 AM - 12:00 PM",
      location: "NU Fairview LRC, 2nd Floor",
      description: "Enclosed single pod with a desk lamp and power outlet."
    },
    {
      id: "D204", name: "Group Discussion Room 204", type: "Group",
      capacity: 6, image: "room-discussion", status: "available",
      hours: "11:00 AM - 1:00 PM",
      location: "NU Fairview LRC, 2nd Floor",
      description: "Enclosed room with a wall display for group work."
    },
    {
      id: "LB", name: "Collaborative Lounge Area B", type: "Collaborative",
      capacity: 10, image: "room-lounge", status: "limited",
      hours: "Next open 10:00 AM",
      location: "NU Fairview LRC, 3rd Floor",
      description: "Open lounge seating for collaborative sessions."
    },
    {
      id: "B302", name: "Silent Study Booth 302", type: "Individual",
      capacity: 1, image: "room-booth", status: "available",
      hours: "9:00 AM - 9:50 PM",
      location: "NU Fairview LRC, 3rd Floor",
      description: "Single booth in the silent reading zone."
    },
    {
      id: "G102", name: "Group Study Room 102", type: "Group",
      capacity: 8, image: "room-group", status: "available",
      hours: "9:00 AM - 1:00 PM",
      location: "NU Fairview LRC, 1st Floor",
      description: "Long table room suited to project meetings."
    },
    {
      id: "SC", name: "Large Seminar Room C", type: "Collaborative",
      capacity: 20, image: "room-seminar", status: "full",
      hours: "Fully booked today",
      location: "NU Fairview LRC, 1st Floor",
      description: "Seminar room with projector and rows of seating."
    }
  ];

  /* ---- Bookable time slots --------------------------------- */
  var SLOTS = ["08:00", "09:00", "10:00", "11:00", "12:00",
               "13:00", "14:00", "15:00", "16:00", "17:00"];

  // Slots that the LRC keeps closed for maintenance or cleaning.
  var BLOCKED = { "LB": ["12:00"], "B302": ["17:00"], "SC": ["08:00"] };

  /* ---- Dates ----------------------------------------------- */

  function toISO(date) {
    var m = String(date.getMonth() + 1);
    var d = String(date.getDate());
    if (m.length < 2) m = "0" + m;
    if (d.length < 2) d = "0" + d;
    return date.getFullYear() + "-" + m + "-" + d;
  }

  function todayISO() {
    return toISO(new Date());
  }

  function shiftISO(iso, days) {
    var parts = iso.split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + days);
    return toISO(d);
  }

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday",
              "Thursday", "Friday", "Saturday"];

  // "2026-08-30" -> "Sunday, August 30, 2026"
  function fmtDateLong(iso) {
    var p = iso.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " "
         + d.getDate() + ", " + d.getFullYear();
  }

  // "2026-08-30" -> "Sun, Aug 30"
  function fmtDateShort(iso) {
    var p = iso.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return DAYS[d.getDay()].slice(0, 3) + ", " + MONTHS[d.getMonth()].slice(0, 3)
         + " " + d.getDate();
  }

  // "13:00" -> "1:00 PM"
  function fmtSlot(slot) {
    var h = Number(slot.split(":")[0]);
    var suffix = h >= 12 ? "PM" : "AM";
    var hour = h % 12;
    if (hour === 0) hour = 12;
    return hour + ":00 " + suffix;
  }

  // "13:00" -> "1:00 PM - 2:00 PM"
  function fmtRange(slot) {
    var h = Number(slot.split(":")[0]);
    var nextSlot = (h + 1 < 10 ? "0" : "") + (h + 1) + ":00";
    return fmtSlot(slot) + " - " + fmtSlot(nextSlot);
  }

  /* ---- Account storage ------------------------------------- */

  function registered() {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function allAccounts() {
    return BUILT_IN.concat(registered());
  }

  function findAccount(username) {
    var name = String(username || "").trim().toLowerCase();
    var list = allAccounts();
    for (var i = 0; i < list.length; i++) {
      if (list[i].username.toLowerCase() === name) return list[i];
    }
    return null;
  }

  function addAccount(account) {
    var list = registered();
    list.push(account);
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(list));
    } catch (e) { /* storage unavailable - the account is not kept */ }
  }

  /* ---- Sign in / sign out ---------------------------------- */

  // Returns { ok: true, user } or { ok: false, field, message }
  function signIn(username, password) {
    var account = findAccount(username);

    if (!account) {
      return {
        ok: false, field: "username",
        message: "No account found for that username. Check your spelling and try again."
      };
    }
    if (account.password !== password) {
      return {
        ok: false, field: "password",
        message: "That password does not match this account. Please re-enter it."
      };
    }

    var session = {
      username: account.username,
      role: account.role,
      name: account.name,
      studentNo: account.studentNo,
      program: account.program,
      email: account.email,
      signedInAt: new Date().toISOString()
    };

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) { /* session lasts for this page only */ }

    return { ok: true, user: session };
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
      return null;
    }
  }

  function signOut() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* nothing to clear */ }
  }

  // Where each role lands after signing in.
  var HOME = {
    student: "../main_dashboard/main_dashboard.html",
    admin:   "../admin_dashboard/admin_dashboard.html"
  };

  // Sends the browser back to login when nobody is signed in, or
  // when the signed in account is not allowed on this page.
  function requireLogin(role) {
    var session = getSession();
    if (!session) {
      window.location.replace("../login/login.html");
      return null;
    }
    if (role && session.role !== role) {
      window.location.replace(HOME[session.role] || "../login/login.html");
      return null;
    }
    return session;
  }

  /* ---- Reservations ---------------------------------------- */

  function seedReservations() {
    var t  = todayISO();
    var t1 = shiftISO(t, 1);
    var t2 = shiftISO(t, 3);

    return [
      { id: "R-1001", areaId: "G102", date: t,  slot: "09:00",
        studentName: "John D. Reyes",  studentNo: "19-0123",
        purpose: "Group Project",   status: "Confirmed" },
      { id: "R-1002", areaId: "D204", date: t,  slot: "10:00",
        studentName: "Maria S. Cruz",  studentNo: "18-0456",
        purpose: "Seminar Prep",    status: "Pending" },
      { id: "R-1003", areaId: "SC",   date: t,  slot: "11:00",
        studentName: "Mata L. Ramos",  studentNo: "19-0451",
        purpose: "Group Project",   status: "Cancelled" },
      { id: "R-1004", areaId: "SC",   date: t,  slot: "12:00",
        studentName: "John T. Aquino", studentNo: "19-0789",
        purpose: "Seminar Prep",    status: "Pending" },
      { id: "R-1005", areaId: "A1",   date: t,  slot: "13:00",
        studentName: "Sam T. Lopez",   studentNo: "20-0789",
        purpose: "Silent Study",    status: "Confirmed" },
      { id: "R-1006", areaId: "A1",   date: t,  slot: "15:00",
        studentName: "Anna L. Santos", studentNo: "19-1122",
        purpose: "Research Collab", status: "Confirmed" },
      { id: "R-1007", areaId: "LB",   date: t,  slot: "16:00",
        studentName: "Anna L. Santos", studentNo: "19-1122",
        purpose: "Research Collab", status: "Completed" },

      // the demo student's own upcoming booking
      { id: "R-1008", areaId: "D204", date: t,  slot: "15:00",
        studentName: "Gabe M. Cruz",   studentNo: "19-12345",
        purpose: "Group Project",   status: "Confirmed" },
      { id: "R-1009", areaId: "B302", date: t1, slot: "09:00",
        studentName: "Gabe M. Cruz",   studentNo: "19-12345",
        purpose: "Silent Study",    status: "Pending" },
      { id: "R-1010", areaId: "G102", date: t2, slot: "14:00",
        studentName: "Gabe M. Cruz",   studentNo: "19-12345",
        purpose: "Thesis Writing",  status: "Confirmed" }
    ];
  }

  function getReservations() {
    var seededOn;
    try {
      seededOn = localStorage.getItem(SEEDED_KEY);
    } catch (e) {
      return seedReservations();
    }

    // Re-seed on a new day so the dashboards always have something
    // dated today to show.
    if (seededOn !== todayISO()) {
      var fresh = seedReservations();
      saveReservations(fresh);
      try {
        localStorage.setItem(SEEDED_KEY, todayISO());
      } catch (e) { /* ignore */ }
      return fresh;
    }

    try {
      return JSON.parse(localStorage.getItem(BOOKING_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveReservations(list) {
    try {
      localStorage.setItem(BOOKING_KEY, JSON.stringify(list));
    } catch (e) { /* ignore */ }
  }

  function addReservation(booking) {
    var list = getReservations();
    booking.id = "R-" + Date.now();
    list.push(booking);
    saveReservations(list);
    return booking;
  }

  function setStatus(id, status) {
    var list = getReservations();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].status = status;
        break;
      }
    }
    saveReservations(list);
  }

  // A slot counts as taken unless the booking was cancelled (FR-04).
  function isSlotTaken(areaId, date, slot) {
    var list = getReservations();
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.areaId === areaId && r.date === date && r.slot === slot
          && r.status !== "Cancelled") {
        return true;
      }
    }
    return false;
  }

  // Slots the LRC keeps closed regardless of bookings.
  function isSlotBlocked(areaId, slot) {
    var closed = BLOCKED[areaId] || [];
    return closed.indexOf(slot) !== -1;
  }

  function reservationsOn(date) {
    return getReservations().filter(function (r) { return r.date === date; });
  }

  function reservationsFor(studentNo) {
    return getReservations().filter(function (r) {
      return r.studentNo === studentNo;
    });
  }

  function getArea(id) {
    for (var i = 0; i < AREAS.length; i++) {
      if (AREAS[i].id === id) return AREAS[i];
    }
    return null;
  }

  /* ---- Small shared helpers -------------------------------- */

  function toast(message, kind) {
    var box = document.getElementById("toast");
    if (!box) return;
    box.textContent = message;
    box.className = "show" + (kind ? " " + kind : "");
    clearTimeout(box._timer);
    box._timer = setTimeout(function () { box.className = ""; }, 3200);
  }

  // Wires up any element with a data-logout attribute.
  function bindLogout() {
    var links = document.querySelectorAll("[data-logout]");
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", function (e) {
        e.preventDefault();
        signOut();
        window.location.href = "../login/login.html";
      });
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  return {
    BUILT_IN: BUILT_IN,
    AREAS: AREAS,
    SLOTS: SLOTS,
    HOME: HOME,
    MONTHS: MONTHS,
    DAYS: DAYS,

    findAccount: findAccount,
    addAccount: addAccount,
    signIn: signIn,
    getSession: getSession,
    signOut: signOut,
    requireLogin: requireLogin,

    getArea: getArea,
    getReservations: getReservations,
    addReservation: addReservation,
    setStatus: setStatus,
    isSlotTaken: isSlotTaken,
    isSlotBlocked: isSlotBlocked,
    reservationsOn: reservationsOn,
    reservationsFor: reservationsFor,

    toISO: toISO,
    todayISO: todayISO,
    shiftISO: shiftISO,
    fmtDateLong: fmtDateLong,
    fmtDateShort: fmtDateShort,
    fmtSlot: fmtSlot,
    fmtRange: fmtRange,

    toast: toast,
    bindLogout: bindLogout,
    escapeHtml: escapeHtml
  };
})();
