/* ============================================================
   admin_dashboard.js - LRC staff / administrative dashboard

   Views (sidebar): Dashboard, Reservations, Study Areas, Reports.
   Everything shown is read live from Firestore; every change goes
   through firebase/firebase-config.js, which writes the matching
   audit entry and student notification in the same transaction.
   ============================================================ */

import {
  requireRole, signOutUser, describeError, LOCATION, INITIAL_FACILITIES, ACTIVE_STATUSES,
  watchFacilities, watchResources, watchSchedule, watchReservationsBetween,
  watchPendingReservations, watchAuditLog, getReservationsBetween,
  decideReservation, setResourceStatus, addResource, nextUnitNumber, saveSchedule,
  upcomingReservationsFor, initializeInventory, hoursOn, millis
} from "../firebase/firebase-config.js";

var loadErr = document.getElementById("loadErr");

function showLoadError(err) {
  loadErr.textContent = describeError(err);
  loadErr.hidden = false;
}

var profile;
try {
  profile = await requireRole("staff");
} catch (err) {
  showLoadError(err);
}

if (profile) start(profile);

function start(staff) {
  var today = NU.todayISO();

  document.getElementById("staffName").textContent = staff.name;
  document.getElementById("staffRole").textContent = staff.title
    || (staff.role === "admin" ? "LRC Supervisor / Administrator" : "LRC Staff");
  document.getElementById("todayLine").textContent = "Current Date, " + NU.fmtDateLong(today);
  document.querySelectorAll("[data-logout]").forEach(function (link) {
    link.addEventListener("click", async function (e) {
      e.preventDefault();
      await signOutUser();
      window.location.href = "../login/login.html";
    });
  });

  /* ---------- live state ---------- */

  var facilities = null;
  var resources = null;
  var schedule;                 // undefined until loaded, null if missing
  var weekRes = null;           // today-6 ... today (dashboard)
  var pending = null;           // every pending reservation
  var rangeRes = null;          // Reservations view range
  var stopRange = null;
  var auditStarted = false;

  var search = document.getElementById("search");
  search.addEventListener("input", function () {
    renderTodayTable();
    renderRangeTable();
  });

  /* ---------- views ---------- */

  var VIEWS = {
    "dashboard": "Main Dashboard",
    "reservations": "Reservations",
    "study-areas": "Study Areas",
    "reports": "Reports"
  };

  function showView() {
    var name = (window.location.hash || "#dashboard").slice(1);
    if (!VIEWS[name]) name = "dashboard";
    Object.keys(VIEWS).forEach(function (key) {
      document.getElementById("view-" + key).hidden = key !== name;
    });
    document.querySelectorAll(".sidebar [data-view]").forEach(function (link) {
      var on = link.getAttribute("data-view") === name;
      link.classList.toggle("active", on);
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.title = VIEWS[name] + " · NU Fairview LRC Booking";
    if (name === "reservations" && !stopRange) subscribeRange();
    if (name === "reports") {
      loadReport();
      if (!auditStarted) startAudit();
    }
  }

  window.addEventListener("hashchange", showView);

  /* ---------- shared helpers ---------- */

  function matchesSearch(r) {
    var q = search.value.trim().toLowerCase();
    if (!q) return true;
    var hay = [r.studentName, r.studentNo, r.resourceLabel, r.facilityName, r.purpose, r.status]
      .concat((r.attendees || []).map(function (a) { return a.name + " " + a.studentNo; }))
      .join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function byTime(a, b) {
    return a.date === b.date ? a.startHour - b.startHour : a.date.localeCompare(b.date);
  }

  function actionCell(r) {
    var id = NU.escapeHtml(r.id);
    var details = '<button class="btn btn-ghost btn-sm" data-detail="' + id + '">Details</button>';
    if (r.status === "pending") {
      return '<div class="acts">'
           + '<button class="btn btn-ok btn-sm" data-act="confirmed" data-id="' + id + '">Approve</button>'
           + '<button class="btn btn-danger btn-sm" data-act="rejected" data-id="' + id + '">Reject</button>'
           + details + '</div>';
    }
    if (r.status === "confirmed") {
      return '<div class="acts">'
           + '<button class="btn btn-ghost btn-sm" data-act="completed" data-id="' + id + '">Mark Done</button>'
           + details + '</div>';
    }
    return '<div class="acts">' + details + '</div>';
  }

  function rowCells(r, withDate) {
    return (withDate ? '<td class="res-time">' + NU.fmtDateShort(r.date) + '</td>' : '')
         + '<td class="res-time">' + NU.fmtRange(r.startHour, r.endHour) + '</td>'
         + '<td>' + NU.escapeHtml(r.resourceLabel)
           + '<span class="res-unit">' + NU.escapeHtml(r.facilityName) + '</span></td>'
         + '<td class="res-student"><b>' + NU.escapeHtml(r.studentName) + '</b>'
           + '<span>' + NU.escapeHtml(r.studentNo) + '</span></td>'
         + '<td>' + NU.escapeHtml(r.purpose)
           + '<span class="res-group">Group of ' + (r.groupSize || 1) + '</span></td>'
         + '<td>' + NU.statusBadge(r.status) + '</td>'
         + '<td>' + actionCell(r) + '</td>';
  }

  function findReservation(id) {
    var pools = [weekRes, pending, rangeRes];
    for (var i = 0; i < pools.length; i++) {
      var hit = (pools[i] || []).filter(function (r) { return r.id === id; })[0];
      if (hit) return hit;
    }
    return null;
  }

  var VERBS = { confirmed: "approved", rejected: "rejected", completed: "marked as completed",
                cancelled: "cancelled" };

  async function decide(id, status, note) {
    await decideReservation(id, status, staff, note);
    NU.toast("Reservation " + VERBS[status] + ". The student has been notified.",
      status === "rejected" || status === "cancelled" ? null : "good");
  }

  // quick actions in the tables
  document.addEventListener("click", async function (e) {
    var act = e.target.closest("[data-act]");
    if (act) {
      var status = act.getAttribute("data-act");
      var r = findReservation(act.getAttribute("data-id"));
      if (!r) return;
      if ((status === "rejected" || status === "cancelled")
          && !window.confirm((status === "rejected" ? "Reject" : "Cancel") + " the reservation of "
            + r.studentName + " for " + r.resourceLabel + "?")) return;
      act.disabled = true;
      try {
        await decide(r.id, status, "");
      } catch (err) {
        act.disabled = false;
        NU.toast(describeError(err), "bad");
      }
      return;
    }
    var detail = e.target.closest("[data-detail]");
    if (detail) openDetails(detail.getAttribute("data-detail"));
  });

  /* ---------- dashboard: tiles, today's table ---------- */

  function activeUnits() {
    return (resources || []).filter(function (r) { return r.status !== "removed"; });
  }

  // reservations holding a unit at hour h today
  function holdingNow(h) {
    return (weekRes || []).filter(function (r) {
      return r.date === today && ACTIVE_STATUSES.indexOf(r.status) !== -1
          && r.startHour <= h && h < r.endHour;
    });
  }

  function renderStats() {
    if (!weekRes || !resources || schedule === undefined) return;
    var todays = weekRes.filter(function (r) { return r.date === today; });
    var live = todays.filter(function (r) { return r.status !== "cancelled" && r.status !== "rejected"; });

    document.getElementById("statToday").textContent = String(live.length);

    var units = activeUnits();
    var bookable = units.filter(function (u) { return u.status === "active"; });
    var open = hoursOn(schedule, today);
    var h = NU.nowHour();
    var isOpen = open && h >= open.openHour && h < open.closeHour;

    if (!isOpen) {
      document.getElementById("statAvailable").textContent = "Closed";
      document.getElementById("statOccupied").textContent = "0";
      return;
    }
    var holding = holdingNow(h);
    var heldIds = {};
    holding.forEach(function (r) { heldIds[r.resourceId] = true; });
    var free = bookable.filter(function (u) { return !heldIds[u.id]; }).length;
    var occupied = holding.filter(function (r) { return r.status === "confirmed"; }).length;

    document.getElementById("statAvailable").textContent = free + "/" + units.length;
    document.getElementById("statOccupied").textContent = String(occupied);
  }

  function renderPending() {
    if (!pending) return;
    document.getElementById("statPending").textContent = String(pending.length);
    var bell = document.getElementById("bellCount");
    bell.textContent = String(pending.length);
    bell.hidden = pending.length === 0;
    document.getElementById("bellLink").setAttribute("aria-label",
      pending.length + " pending reservation" + (pending.length === 1 ? "" : "s"));
  }

  function renderTodayTable() {
    var body = document.getElementById("resBody");
    if (!weekRes) return;

    var rows = weekRes.filter(function (r) { return r.date === today; })
      .filter(matchesSearch).sort(byTime);

    document.getElementById("rowCount").textContent =
      rows.length + (rows.length === 1 ? " record" : " records");

    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty" colspan="6">'
        + (search.value.trim() ? "No reservations today match this search."
                               : "No reservations for today yet.") + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) { return '<tr>' + rowCells(r, false) + '</tr>'; }).join("");
  }

  /* ---------- dashboard: availability by study area ---------- */

  function renderAvailability() {
    var grid = document.getElementById("availGrid");
    if (!facilities || !resources || !weekRes || schedule === undefined) return;
    if (!facilities.length) {
      grid.innerHTML = '<p class="res-empty">No study areas set up yet.</p>';
      return;
    }

    var open = hoursOn(schedule, today);
    var h = NU.nowHour();
    var isOpen = open && h >= open.openHour && h < open.closeHour;
    document.getElementById("availWhen").textContent = isOpen
      ? "Right now (" + NU.fmtRange(h) + ")"
      : "The LRC is closed right now" + (open ? " (open " + NU.fmtRange(open.openHour, open.closeHour) + " today)." : " today.");

    var heldIds = {};
    if (isOpen) holdingNow(h).forEach(function (r) { heldIds[r.resourceId] = true; });

    grid.innerHTML = facilities.map(function (f) {
      var units = resources.filter(function (r) { return r.facilityId === f.id && r.status !== "removed"; });
      var down = units.filter(function (u) { return u.status !== "active"; }).length;
      var held = units.filter(function (u) { return u.status === "active" && heldIds[u.id]; }).length;
      var free = units.length - down - held;

      var cls, label;
      if (!isOpen) { cls = "closed"; label = "LRC closed"; }
      else if (free > 0) { cls = "free"; label = free + " of " + units.length + " available"; }
      else if (held > 0) { cls = "held"; label = "Fully reserved"; }
      else { cls = "closed"; label = "Unavailable"; }

      return '<div class="avail-cell ' + cls + '">'
           + '<span class="avail-name">' + NU.escapeHtml(f.name) + '</span>'
           + label
           + '<span class="avail-sub">' + held + ' reserved &middot; ' + down + ' unavailable</span>'
           + '</div>';
    }).join("");
  }

  /* ---------- bar charts ---------- */

  function renderBars(el, labels, counts, title) {
    var max = Math.max.apply(null, counts.concat([0]));
    if (max === 0) {
      el.innerHTML = '<p class="res-empty chart-empty">No bookings in this period yet.</p>';
      el.style.display = "block";
      return;
    }
    el.style.display = "";
    el.style.setProperty("--cols", String(labels.length));
    var peak = counts.indexOf(max);
    var axis = '<div class="chart-axis" aria-hidden="true">'
             + '<span>' + max + '</span><span>' + Math.round(max / 2) + '</span><span>0</span></div>';
    var plot = '<div class="chart-plot">' + counts.map(function (n, i) {
      var height = Math.round((n / max) * 100);
      return '<div class="chart-col" title="' + labels[i] + ': ' + n + ' ' + title + '">'
           + '<div class="chart-bar' + (i === peak ? " peak" : "")
             + '" style="height:' + height + '%"></div>'
           + '<span class="chart-day">' + labels[i] + '</span></div>';
    }).join("") + '</div>';
    el.innerHTML = axis + plot;
    el.setAttribute("aria-label", labels.map(function (l, i) {
      return l + " " + counts[i];
    }).join(", ") + " " + title);
  }

  function isBooked(r) {
    return r.status !== "cancelled" && r.status !== "rejected";
  }

  function renderWeekChart() {
    if (!weekRes) return;
    var labels = [];
    var counts = [];
    for (var i = 6; i >= 0; i--) {
      var day = NU.shiftISO(today, -i);
      labels.push(NU.DAYS[NU.weekday(day)].slice(0, 3));
      counts.push(weekRes.filter(function (r) { return r.date === day && isBooked(r); }).length);
    }
    document.getElementById("chartCaption").textContent = "Bookings per day, "
      + NU.fmtDateShort(NU.shiftISO(today, -6)) + " - " + NU.fmtDateShort(today)
      + " (excludes cancelled and rejected).";
    renderBars(document.getElementById("chart"), labels, counts, "bookings");
  }

  function renderDashboard() {
    renderStats();
    renderTodayTable();
    renderAvailability();
    renderWeekChart();
  }

  /* ---------- reservations view ---------- */

  var fromDate = document.getElementById("fromDate");
  var toDate = document.getElementById("toDate");
  var statusFilter = document.getElementById("statusFilter");
  var facilityFilter = document.getElementById("facilityFilter");

  fromDate.value = NU.shiftISO(today, -7);
  toDate.value = NU.shiftISO(today, 30);

  function subscribeRange() {
    if (stopRange) stopRange();
    if (!fromDate.value || !toDate.value || fromDate.value > toDate.value) {
      document.getElementById("allBody").innerHTML =
        '<tr><td class="empty" colspan="7">Choose a valid date range: "From" must be on or before "To".</td></tr>';
      stopRange = null;
      return;
    }
    rangeRes = null;
    document.getElementById("allBody").innerHTML =
      '<tr><td class="empty" colspan="7"><span class="loading">Loading reservations...</span></td></tr>';
    stopRange = watchReservationsBetween(fromDate.value, toDate.value, function (list) {
      rangeRes = list;
      renderRangeTable();
    }, function (err) {
      document.getElementById("allBody").innerHTML =
        '<tr><td class="empty" colspan="7">' + NU.escapeHtml(describeError(err)) + '</td></tr>';
    });
  }

  fromDate.addEventListener("change", subscribeRange);
  toDate.addEventListener("change", subscribeRange);
  statusFilter.addEventListener("change", renderRangeTable);
  facilityFilter.addEventListener("change", renderRangeTable);

  function renderRangeTable() {
    if (!rangeRes) return;
    var rows = rangeRes.filter(function (r) {
      return (statusFilter.value === "all" || r.status === statusFilter.value)
          && (facilityFilter.value === "all" || r.facilityId === facilityFilter.value)
          && matchesSearch(r);
    }).sort(byTime);

    document.getElementById("rangeTitle").textContent = "Reservations, "
      + NU.fmtDateShort(fromDate.value) + " - " + NU.fmtDateShort(toDate.value);
    document.getElementById("allCount").textContent =
      rows.length + (rows.length === 1 ? " record" : " records");

    document.getElementById("allBody").innerHTML = rows.length
      ? rows.map(function (r) { return '<tr>' + rowCells(r, true) + '</tr>'; }).join("")
      : '<tr><td class="empty" colspan="7">No reservations match these filters.</td></tr>';
  }

  function fillFacilityFilter() {
    var keep = facilityFilter.value;
    facilityFilter.innerHTML = '<option value="all">All study areas</option>'
      + facilities.map(function (f) {
          return '<option value="' + NU.escapeHtml(f.id) + '">' + NU.escapeHtml(f.name) + '</option>';
        }).join("");
    facilityFilter.value = facilityFilter.querySelector('option[value="' + keep + '"]') ? keep : "all";
  }

  /* ---------- reservation details dialog ---------- */

  var detailVeil = document.getElementById("detailVeil");
  var detailErr = document.getElementById("detailErr");
  var detailId = null;

  function openDetails(id) {
    var r = findReservation(id);
    if (!r) return;
    detailId = id;
    detailErr.classList.remove("show");
    document.getElementById("staffNote").value = "";

    var attendees = (r.attendees || []).length
      ? '<ul>' + r.attendees.map(function (a) {
          return '<li>' + NU.escapeHtml(a.name) + ' (' + NU.escapeHtml(a.studentNo) + ')</li>';
        }).join("") + '</ul>'
      : (r.facilityType === "discussion" ? "None listed" : "Not applicable");

    var rows = [
      ["Student", NU.escapeHtml(r.studentName) + " (" + NU.escapeHtml(r.studentNo) + ")"],
      ["Study Area", NU.escapeHtml(r.facilityName)],
      ["Unit", NU.escapeHtml(r.resourceLabel) + ' <span class="unit-id">' + NU.escapeHtml(r.resourceId) + '</span>'],
      ["Capacity", NU.capacityText(r.capacity)],
      ["Location", NU.escapeHtml(r.location || LOCATION)],
      ["Date", NU.fmtDateLong(r.date)],
      ["Time", NU.fmtRange(r.startHour, r.endHour) + " (" + NU.fmtDuration(r.endHour - r.startHour) + ")"],
      ["Purpose", NU.escapeHtml(r.purpose)],
      ["Group Size", String(r.groupSize || 1) + (r.groupSize > 1 ? " (student + " + (r.groupSize - 1) + ")" : "")],
      ["Attendees", attendees],
      ["Status", NU.statusBadge(r.status)],
      ["Submitted", NU.fmtStamp(r.createdAt)]
    ];
    if (r.decidedByName) rows.push(["Last action", NU.escapeHtml(r.decidedByName) + ", " + NU.fmtStamp(r.decidedAt)]);
    if (r.staffNote) rows.push(["Staff note", NU.escapeHtml(r.staffNote)]);

    document.getElementById("detailKv").innerHTML = rows.map(function (kv) {
      return '<dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd>';
    }).join("");
    document.getElementById("detailSub").textContent = "Reservation " + r.id;

    var actions = [];
    if (r.status === "pending") {
      actions.push('<button type="button" class="btn btn-ok grow" data-decide="confirmed">Approve</button>');
      actions.push('<button type="button" class="btn btn-danger" data-decide="rejected">Reject</button>');
    }
    if (r.status === "confirmed") {
      actions.push('<button type="button" class="btn btn-navy grow" data-decide="completed">Mark Completed</button>');
    }
    if (r.status === "pending" || r.status === "confirmed") {
      actions.push('<button type="button" class="btn btn-ghost" data-decide="cancelled">Cancel Booking</button>');
    }
    actions.push('<button type="button" class="btn btn-ghost" data-close>Close</button>');
    document.getElementById("detailActions").innerHTML = actions.join("");
    document.getElementById("noteField").hidden = actions.length === 1;

    detailVeil.hidden = false;
    detailVeil.querySelector(".dialog button").focus();
  }

  function closeDetails() {
    detailVeil.hidden = true;
    detailId = null;
  }

  detailVeil.addEventListener("click", async function (e) {
    if (e.target === detailVeil || e.target.closest("[data-close]")) {
      closeDetails();
      return;
    }
    var btn = e.target.closest("[data-decide]");
    if (!btn || !detailId) return;
    var status = btn.getAttribute("data-decide");
    btn.disabled = true;
    try {
      await decide(detailId, status, document.getElementById("staffNote").value.trim());
      closeDetails();
    } catch (err) {
      btn.disabled = false;
      detailErr.textContent = describeError(err);
      detailErr.classList.add("show");
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!detailVeil.hidden) closeDetails();
    if (!removeVeil.hidden) removeVeil.hidden = true;
  });

  /* ---------- study areas: schedule editor ---------- */

  var DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var draftDays = null;
  var draftClosed = null;
  var scheduleDirty = false;
  var scheduleErr = document.getElementById("scheduleErr");

  function hourOptions(from, to, selected) {
    var html = "";
    for (var h = from; h <= to; h++) {
      html += '<option value="' + h + '"' + (h === selected ? " selected" : "") + '>'
            + (h === 24 ? "12:00 AM (midnight)" : NU.fmtHour(h)) + '</option>';
    }
    return html;
  }

  function loadDraft() {
    if (scheduleDirty) return;
    var source = schedule || { days: {}, closedDates: [] };
    draftDays = {};
    for (var d = 1; d <= 7; d++) {
      var day = source.days[String(d)] || { open: false, openHour: 8, closeHour: 17 };
      draftDays[d] = { open: !!day.open, openHour: day.openHour, closeHour: day.closeHour };
    }
    draftClosed = (source.closedDates || []).slice().sort();
    renderScheduleEditor();
  }

  function renderScheduleEditor() {
    var body = document.getElementById("scheduleBody");
    var rows = "";
    for (var d = 1; d <= 7; d++) {
      var day = draftDays[d];
      rows += '<tr>'
        + '<th scope="row">' + DAY_NAMES[d] + '</th>'
        + '<td><label class="checkline"><input type="checkbox" data-day="' + d + '" data-field="open"'
          + (day.open ? " checked" : "") + '><span>' + (day.open ? "Open" : "Closed") + '</span></label></td>'
        + '<td><label class="sr-only" for="open' + d + '">' + DAY_NAMES[d] + ' opening time</label>'
          + '<select class="input" id="open' + d + '" data-day="' + d + '" data-field="openHour"'
          + (day.open ? "" : " disabled") + '>' + hourOptions(0, 23, day.openHour) + '</select></td>'
        + '<td><label class="sr-only" for="close' + d + '">' + DAY_NAMES[d] + ' closing time</label>'
          + '<select class="input" id="close' + d + '" data-day="' + d + '" data-field="closeHour"'
          + (day.open ? "" : " disabled") + '>' + hourOptions(1, 24, day.closeHour) + '</select></td>'
        + '</tr>';
    }
    body.innerHTML = rows;

    document.getElementById("closedList").innerHTML = draftClosed.length
      ? draftClosed.map(function (iso) {
          return '<li>' + NU.fmtDateShort(iso) + ', ' + iso.slice(0, 4)
               + '<button type="button" data-unclose="' + iso + '" aria-label="Remove closure on '
               + NU.fmtDateLong(iso) + '">&times;</button></li>';
        }).join("")
      : '<li class="hint">No closure dates.</li>';

    var meta = document.getElementById("scheduleMeta");
    meta.textContent = schedule && schedule.updatedAt
      ? "Last updated " + NU.fmtStamp(schedule.updatedAt) : (schedule ? "" : "Not saved yet");
  }

  document.getElementById("scheduleBody").addEventListener("change", function (e) {
    var el = e.target;
    var d = Number(el.getAttribute("data-day"));
    var field = el.getAttribute("data-field");
    if (!d || !field) return;
    scheduleDirty = true;
    draftDays[d][field] = field === "open" ? el.checked : Number(el.value);
    scheduleErr.classList.remove("show");
    if (field === "open") renderScheduleEditor();
  });

  document.getElementById("addClosedDate").addEventListener("click", function () {
    var input = document.getElementById("closedDateInput");
    if (!input.value) {
      NU.toast("Pick a date to add.", "bad");
      return;
    }
    if (draftClosed.indexOf(input.value) === -1) {
      draftClosed.push(input.value);
      draftClosed.sort();
      scheduleDirty = true;
    }
    input.value = "";
    renderScheduleEditor();
  });

  document.getElementById("closedList").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-unclose]");
    if (!btn) return;
    draftClosed = draftClosed.filter(function (iso) { return iso !== btn.getAttribute("data-unclose"); });
    scheduleDirty = true;
    renderScheduleEditor();
  });

  document.getElementById("saveSchedule").addEventListener("click", async function () {
    var btn = this;
    var days = {};
    var parts = [];
    for (var d = 1; d <= 7; d++) {
      var day = draftDays[d];
      if (day.open && day.openHour >= day.closeHour) {
        scheduleErr.textContent = DAY_NAMES[d] + ": the closing time must be later than the opening time.";
        scheduleErr.classList.add("show");
        return;
      }
      days[String(d)] = { open: day.open, openHour: day.openHour, closeHour: day.closeHour };
      parts.push(DAY_NAMES[d].slice(0, 3) + " " + (day.open ? NU.fmtRange(day.openHour, day.closeHour) : "closed"));
    }
    // keep only today and later closures
    var closed = draftClosed.filter(function (iso) { return iso >= today; });

    btn.disabled = true;
    try {
      await saveSchedule(days, closed, staff, "Updated LRC hours: " + parts.join(", ")
        + (closed.length ? "; closed on " + closed.join(", ") : ""));
      scheduleDirty = false;
      NU.toast("Operating hours saved. Student availability is updated.", "good");
    } catch (err) {
      scheduleErr.textContent = "Not saved. " + describeError(err);
      scheduleErr.classList.add("show");
    }
    btn.disabled = false;
  });

  /* ---------- study areas: units ---------- */

  var facilityBox = document.getElementById("facilityManage");

  function renderUnits() {
    if (!facilities || !resources) return;
    if (!facilities.length) {
      facilityBox.innerHTML = '<p class="res-empty">No study areas yet. Use "Initialize LRC inventory" above.</p>';
      return;
    }
    facilityBox.innerHTML = facilities.map(function (f) {
      var units = resources.filter(function (r) { return r.facilityId === f.id; });
      var listed = units.filter(function (u) { return u.status !== "removed"; });
      var removed = units.filter(function (u) { return u.status === "removed"; });
      var nextLabel = f.unitPrefix + " " + nextUnitNumber(f.id, resources);

      var rows = listed.map(function (u) {
        var isActive = u.status === "active";
        return '<tr>'
          + '<td><b>' + NU.escapeHtml(u.label) + '</b></td>'
          + '<td class="unit-id">' + NU.escapeHtml(u.id) + '</td>'
          + '<td>' + (isActive ? '<span class="badge badge-ok">Available</span>'
                              : '<span class="badge badge-danger">Unavailable</span>'
                                + (u.statusNote ? '<span class="res-unit">' + NU.escapeHtml(u.statusNote) + '</span>' : ''))
          + '</td>'
          + '<td><div class="acts">'
            + (isActive
                ? '<button class="btn btn-ghost btn-sm" data-unit-act="maintenance" data-unit="' + NU.escapeHtml(u.id) + '">Mark unavailable</button>'
                : '<button class="btn btn-ok btn-sm" data-unit-act="active" data-unit="' + NU.escapeHtml(u.id) + '">Reopen</button>')
            + '<button class="btn btn-danger btn-sm" data-unit-act="removed" data-unit="' + NU.escapeHtml(u.id) + '">Remove</button>'
          + '</div></td>'
          + '</tr>';
      }).join("");

      return '<div class="card">'
        + '<div class="card-head"><h3>' + NU.escapeHtml(f.name)
          + (f.alias ? ' <span class="hint-inline">(' + NU.escapeHtml(f.alias) + ')</span>' : '') + '</h3>'
          + '<span class="badge badge-info">' + listed.length + (listed.length === 1 ? " unit" : " units")
          + ' &middot; ' + NU.capacityText(f.capacityPerUnit) + ' each</span>'
          + '<button type="button" class="btn btn-primary btn-sm right" data-add-unit="' + NU.escapeHtml(f.id) + '">Add '
          + NU.escapeHtml(nextLabel) + '</button></div>'
        + '<div class="table-scroll"><table class="table unit-table">'
          + '<thead><tr><th scope="col">Unit</th><th scope="col">Stable ID</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>'
          + '<tbody>' + (rows || '<tr><td class="empty" colspan="4">No units in this area.</td></tr>') + '</tbody>'
        + '</table></div>'
        + (removed.length
            ? '<details class="removed-units"><summary>Removed units (' + removed.length + ') - kept for history</summary><ul>'
              + removed.map(function (u) {
                  return '<li>' + NU.escapeHtml(u.label) + ' <span class="unit-id">' + NU.escapeHtml(u.id)
                       + '</span> removed ' + NU.fmtStamp(u.removedAt) + '</li>';
                }).join("") + '</ul></details>'
            : '')
        + '</div>';
    }).join("");
  }

  facilityBox.addEventListener("click", async function (e) {
    var addBtn = e.target.closest("[data-add-unit]");
    if (addBtn) {
      var facility = facilities.filter(function (f) { return f.id === addBtn.getAttribute("data-add-unit"); })[0];
      var label = facility.unitPrefix + " " + nextUnitNumber(facility.id, resources);
      if (!window.confirm("Add " + label + " to " + facility.name + "? Students can book it right away.")) return;
      addBtn.disabled = true;
      try {
        var added = await addResource(facility, resources, staff);
        NU.toast(added + " added.", "good");
      } catch (err) {
        addBtn.disabled = false;
        NU.toast(describeError(err), "bad");
      }
      return;
    }

    var actBtn = e.target.closest("[data-unit-act]");
    if (!actBtn) return;
    var unit = resources.filter(function (r) { return r.id === actBtn.getAttribute("data-unit"); })[0];
    var status = actBtn.getAttribute("data-unit-act");
    if (!unit) return;

    if (status === "removed") {
      openRemove(unit);
      return;
    }

    var note = "";
    if (status === "maintenance") {
      var upcoming;
      try {
        upcoming = await upcomingReservationsFor(unit.id);
      } catch (err) {
        NU.toast(describeError(err), "bad");
        return;
      }
      note = window.prompt("Mark " + unit.label + " unavailable. Reason shown to students (optional):",
        "Maintenance");
      if (note === null) return;
      if (upcoming.length && !window.confirm(unit.label + " has " + upcoming.length
          + " upcoming reservation(s). They are NOT cancelled automatically - review them in "
          + "Reservations. Continue?")) return;
    }

    actBtn.disabled = true;
    try {
      await setResourceStatus(unit, status, staff, (note || "").trim().slice(0, 120));
      NU.toast(unit.label + (status === "active" ? " is available again." : " marked unavailable."), "good");
    } catch (err) {
      actBtn.disabled = false;
      NU.toast(describeError(err), "bad");
    }
  });

  /* ---------- unit removal ---------- */

  var removeVeil = document.getElementById("removeVeil");
  var removeErr = document.getElementById("removeErr");
  var removeBtn = document.getElementById("removeConfirm");
  var removing = null;

  async function openRemove(unit) {
    removing = { unit: unit, upcoming: [] };
    removeErr.classList.remove("show");
    document.getElementById("removeTitle").textContent = "Remove " + unit.label;
    document.getElementById("removeSub").textContent = "Checking upcoming reservations...";
    document.getElementById("removeList").innerHTML = "";
    removeBtn.disabled = true;
    removeVeil.hidden = false;

    try {
      removing.upcoming = await upcomingReservationsFor(unit.id);
    } catch (err) {
      removeErr.textContent = describeError(err);
      removeErr.classList.add("show");
      return;
    }

    var list = removing.upcoming;
    document.getElementById("removeSub").textContent = list.length
      ? unit.label + " has " + list.length + " upcoming reservation(s). They must be cancelled before the unit "
        + "is removed. Each student will get an in-app notification."
      : "No upcoming reservations. The unit's record and booking history are kept, and its number can be "
        + "reused by a new unit later.";
    document.getElementById("removeList").innerHTML = list.map(function (r) {
      return '<li>' + NU.fmtDateShort(r.date) + ', ' + NU.fmtRange(r.startHour, r.endHour) + ' - '
           + NU.escapeHtml(r.studentName) + ' (' + NU.statusBadge(r.status) + ')</li>';
    }).join("");
    removeBtn.textContent = list.length
      ? "Cancel " + list.length + " reservation(s) and remove" : "Remove unit";
    removeBtn.disabled = false;
    removeBtn.focus();
  }

  removeBtn.addEventListener("click", async function () {
    if (!removing) return;
    removeBtn.disabled = true;
    var unit = removing.unit;
    try {
      for (var i = 0; i < removing.upcoming.length; i++) {
        await decideReservation(removing.upcoming[i].id, "cancelled", staff,
          unit.label + " has been removed from service. Please book another unit.");
      }
      await setResourceStatus(unit, "removed", staff, "");
      removeVeil.hidden = true;
      NU.toast(unit.label + " removed. Its history is kept.", "good");
    } catch (err) {
      removeBtn.disabled = false;
      removeErr.textContent = describeError(err);
      removeErr.classList.add("show");
      if (err.code === "lrc/has-future-reservations") openRemove(unit);
    }
  });

  document.getElementById("removeCancel").addEventListener("click", function () {
    removeVeil.hidden = true;
  });
  removeVeil.addEventListener("click", function (e) {
    if (e.target === removeVeil) removeVeil.hidden = true;
  });

  /* ---------- reports ---------- */

  var reportSeq = 0;

  function reportRange() {
    var period = document.getElementById("reportPeriod").value;
    if (period === "month") return { from: today.slice(0, 8) + "01", to: today, label: "This month" };
    var days = Number(period);
    return { from: NU.shiftISO(today, -(days - 1)), to: today, label: "Last " + days + " days" };
  }

  document.getElementById("reportPeriod").addEventListener("change", loadReport);

  async function loadReport() {
    var seq = ++reportSeq;
    var range = reportRange();
    var label = document.getElementById("reportLabel");
    label.className = "banner banner-info";
    label.textContent = "Loading report for " + NU.fmtDateShort(range.from) + " - " + NU.fmtDateShort(range.to) + "...";

    var list;
    try {
      list = await getReservationsBetween(range.from, range.to);
    } catch (err) {
      if (seq !== reportSeq) return;
      label.className = "banner banner-bad";
      label.textContent = "The report could not be loaded. " + describeError(err);
      return;
    }
    if (seq !== reportSeq || !facilities || !resources || schedule === undefined) return;

    var booked = list.filter(isBooked);
    document.getElementById("rpTotal").textContent = String(list.length);
    document.getElementById("rpDone").textContent = String(list.filter(function (r) {
      return r.status === "confirmed" || r.status === "completed";
    }).length);
    document.getElementById("rpLost").textContent = String(list.length - booked.length);

    // open hours per day in the period, from the current schedule
    var openHoursTotal = 0;
    var minHour = 24, maxHour = 0;
    for (var day = range.from; day <= range.to; day = NU.shiftISO(day, 1)) {
      var open = hoursOn(schedule, day);
      if (open) {
        openHoursTotal += open.closeHour - open.openHour;
        minHour = Math.min(minHour, open.openHour);
        maxHour = Math.max(maxHour, open.closeHour);
      }
    }

    var totalBooked = 0, totalCapacity = 0;
    document.getElementById("occBody").innerHTML = facilities.map(function (f) {
      var units = resources.filter(function (r) { return r.facilityId === f.id && r.status !== "removed"; }).length;
      var hours = booked.filter(function (r) { return r.facilityId === f.id; })
        .reduce(function (sum, r) { return sum + (r.endHour - r.startHour); }, 0);
      var capacity = units * openHoursTotal;
      totalBooked += hours;
      totalCapacity += capacity;
      return '<tr><td>' + NU.escapeHtml(f.name) + '</td><td>' + units + '</td><td>' + hours
           + '</td><td>' + capacity + '</td><td><b>' + pct(hours, capacity) + '</b></td></tr>';
    }).join("") || '<tr><td class="empty" colspan="5">No study areas set up yet.</td></tr>';
    document.getElementById("rpRate").textContent = pct(totalBooked, totalCapacity);

    // booked hours by time of day
    if (minHour >= maxHour) { minHour = 7; maxHour = 19; }
    var labels = [], counts = [];
    for (var h = minHour; h < maxHour; h++) {
      labels.push(NU.fmtHour(h).replace(":00 ", ""));
      counts.push(booked.filter(function (r) { return r.startHour <= h && h < r.endHour; }).length);
    }
    renderBars(document.getElementById("peakChart"), labels, counts, "booked hours");

    label.textContent = "Reporting period: " + range.label + ", " + NU.fmtDateLong(range.from)
      + " to " + NU.fmtDateLong(range.to) + " (NU Fairview time). "
      + (list.length ? list.length + " reservation record(s)." : "No reservations in this period yet.")
      + " Generated " + NU.fmtStamp(Date.now()) + ".";
  }

  function pct(part, whole) {
    if (!whole) return "0%";
    return (Math.round((part / whole) * 1000) / 10) + "%";
  }

  function startAudit() {
    auditStarted = true;
    var box = document.getElementById("auditList");
    watchAuditLog(50, function (entries) {
      box.innerHTML = entries.length ? entries.map(function (a) {
        return '<li data-kind="' + NU.escapeHtml(a.targetType) + '">' + NU.escapeHtml(a.summary)
             + '<span class="who-when">' + NU.escapeHtml(a.actorName) + ' &middot; '
             + NU.fmtStamp(a.createdAt) + ' &middot; ' + NU.escapeHtml(a.action) + '</span></li>';
      }).join("") : '<li class="res-empty">No administrative activity recorded yet.</li>';
    }, function (err) {
      box.innerHTML = '<li class="res-empty">' + NU.escapeHtml(describeError(err)) + '</li>';
    });
  }

  /* ---------- one-time inventory setup ---------- */

  var setupCard = document.getElementById("setupCard");
  var settingUp = false;

  // Shown while any initial facility, unit, or the schedule is missing
  // (removed units still exist as records, so they do not count).
  function renderSetup() {
    if (!facilities || !resources || schedule === undefined || settingUp) return;
    var ids = {};
    resources.forEach(function (r) { ids[r.id] = true; });
    var missingUnit = INITIAL_FACILITIES.some(function (f) {
      for (var n = 1; n <= f.initialUnits; n++) {
        if (!ids[f.unitIdPrefix + n]) return true;
      }
      return false;
    });
    setupCard.hidden = !(facilities.length < INITIAL_FACILITIES.length || !schedule || missingUnit);
  }

  document.getElementById("setupBtn").addEventListener("click", async function () {
    var btn = this;
    var progress = document.getElementById("setupProgress");
    btn.disabled = true;
    settingUp = true;
    progress.textContent = "Creating facilities and schedule...";
    try {
      var created = await initializeInventory(staff, function (done, total) {
        progress.textContent = "Creating units: " + done + " of " + total + "...";
      });
      progress.textContent = "";
      settingUp = false;
      renderSetup();
      NU.toast("LRC inventory ready: " + created + " units created.", "good");
    } catch (err) {
      settingUp = false;
      btn.disabled = false;
      progress.textContent = "Setup stopped. " + describeError(err) + " You can run it again safely.";
    }
  });

  /* ---------- go ---------- */

  watchFacilities(function (data) {
    facilities = data;
    fillFacilityFilter();
    renderSetup();
    renderUnits();
    renderDashboard();
  }, showLoadError);

  watchResources(function (data) {
    resources = data;
    renderSetup();
    renderUnits();
    renderDashboard();
  }, showLoadError);

  watchSchedule(function (data) {
    schedule = data;
    loadDraft();
    renderSetup();
    renderDashboard();
  }, showLoadError);

  watchReservationsBetween(NU.shiftISO(today, -6), today, function (list) {
    weekRes = list;
    renderDashboard();
  }, function (err) {
    showLoadError(err);
    document.getElementById("resBody").innerHTML =
      '<tr><td class="empty" colspan="6">' + NU.escapeHtml(describeError(err)) + '</td></tr>';
  });

  watchPendingReservations(function (list) {
    pending = list;
    renderPending();
  }, showLoadError);

  showView();
  setInterval(function () {
    if (NU.todayISO() !== today) window.location.reload();   // new day: reload ranges
    renderDashboard();
  }, 60 * 1000);
}
