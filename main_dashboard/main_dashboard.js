/* ============================================================
   main_dashboard.js - Find a Study Area (student dashboard)

   Facilities, units, the LRC schedule, booked slots, and the
   student's own reservations and notifications are all live
   Firestore listeners from firebase/firebase-config.js.
   ============================================================ */

import {
  requireRole, signOutUser, describeError, LOCATION,
  watchFacilities, watchResources, watchSchedule, watchSlotLocks,
  watchMyReservations, watchMyNotifications, markNotificationsRead,
  hoursOn, bookedSet, slotStates, millis, ACTIVE_STATUSES
} from "../firebase/firebase-config.js";

var loadErr = document.getElementById("loadErr");

function showLoadError(err) {
  loadErr.textContent = describeError(err);
  loadErr.hidden = false;
}

var profile;
try {
  profile = await requireRole("student");
} catch (err) {
  showLoadError(err);
}

if (profile) start(profile);

function start(session) {
  /* ---------- header ---------- */

  document.getElementById("userName").textContent = session.name;
  document.getElementById("userId").textContent   = "ID: " + session.studentNo;
  document.querySelectorAll("[data-logout]").forEach(function (link) {
    link.addEventListener("click", async function (e) {
      e.preventDefault();
      await signOutUser();
      window.location.href = "../login/login.html";
    });
  });
  NU.bindSoon();

  /* ---------- state from Firestore ---------- */

  var facilities = null;
  var resources = null;
  var schedule;                 // undefined until loaded, null if missing
  var locks = null;
  var stopLocks = null;

  /* ---------- filter controls ---------- */

  var dateInput  = document.getElementById("date");
  var slotSelect = document.getElementById("slot");
  var capSelect  = document.getElementById("capacity");
  var list       = document.getElementById("facilityList");
  var resultLine = document.getElementById("resultLine");
  var noResults  = document.getElementById("noResults");

  var activeType = "all";

  // keep a date the student picked while the page was still signing in
  if (!dateInput.value || dateInput.value < NU.todayISO()) dateInput.value = NU.todayISO();
  dateInput.min = NU.todayISO();

  var segButtons = document.querySelectorAll("#typeSeg button");
  segButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      segButtons.forEach(function (b) {
        b.classList.toggle("on", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      activeType = btn.getAttribute("data-type");
      render();
    });
  });

  capSelect.addEventListener("change", render);
  slotSelect.addEventListener("change", render);
  dateInput.addEventListener("change", function () {
    if (!dateInput.value || dateInput.value < NU.todayISO()) dateInput.value = NU.todayISO();
    fillSlots();
    subscribeLocks();
  });

  document.getElementById("searchBtn").addEventListener("click", function () {
    render();
    NU.toast("Filters applied.");
  });

  document.getElementById("resetBtn").addEventListener("click", function () {
    activeType = "all";
    segButtons.forEach(function (b) {
      var on = b.getAttribute("data-type") === "all";
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    capSelect.value = "any";
    dateInput.value = NU.todayISO();
    fillSlots();
    slotSelect.value = "any";
    subscribeLocks();
  });

  // time slot choices follow the LRC hours for the chosen date
  function fillSlots() {
    var keep = slotSelect.value;
    slotSelect.innerHTML = '<option value="any">Any time</option>';
    var open = schedule ? hoursOn(schedule, dateInput.value) : null;
    if (open) {
      for (var h = open.openHour; h < open.closeHour; h++) {
        var option = document.createElement("option");
        option.value = String(h);
        option.textContent = NU.fmtRange(h);
        slotSelect.appendChild(option);
      }
    }
    slotSelect.value = slotSelect.querySelector('option[value="' + keep + '"]') ? keep : "any";
  }

  function subscribeLocks() {
    if (stopLocks) stopLocks();
    locks = null;
    render();
    stopLocks = watchSlotLocks(dateInput.value, function (data) {
      locks = data;
      render();
    }, showLoadError);
  }

  /* ---------- render the facilities and their units ---------- */

  function capacityMatches(facility) {
    var band = capSelect.value;
    if (band === "1") return facility.capacityPerUnit === 1;
    if (band === "group") return facility.capacityPerUnit >= 2;
    return true;
  }

  function hoursText(date) {
    var open = hoursOn(schedule, date);
    return open
      ? "Open " + NU.fmtRange(open.openHour, open.closeHour) + " on " + NU.fmtDateShort(date)
      : "LRC closed on " + NU.fmtDateShort(date);
  }

  // What one unit's chip says for the chosen date and slot.
  function unitView(unit, date, slot, booked) {
    var states = slotStates(unit, schedule, booked, date);
    if (unit.status !== "active") {
      return { cls: "off", text: "Unavailable", detail: unit.statusNote || "Maintenance / closure" };
    }
    if (!states.length) return { cls: "off", text: "Unavailable", detail: "LRC closed" };

    if (slot !== "any") {
      var match = states.filter(function (s) { return s.hour === Number(slot); })[0];
      if (!match || match.state === "past") {
        return { cls: "off", text: "Unavailable", detail: "Time has passed" };
      }
      if (match.state === "reserved") return { cls: "taken", text: "Reserved", detail: NU.fmtRange(match.hour) };
      return { cls: "free", text: "Available", detail: NU.fmtRange(match.hour), bookable: true };
    }

    var free = states.filter(function (s) { return s.state === "free"; }).length;
    var reserved = states.filter(function (s) { return s.state === "reserved"; }).length;
    if (free) {
      return { cls: "free", text: "Available", bookable: true,
               detail: free + (free === 1 ? " open slot" : " open slots") };
    }
    if (reserved) return { cls: "taken", text: "Reserved", detail: "Fully booked" };
    return { cls: "off", text: "Unavailable", detail: "No slots left today" };
  }

  function render() {
    if (!facilities || !resources || schedule === undefined) return;

    var date = dateInput.value || NU.todayISO();
    var slot = slotSelect.value;

    if (!facilities.length) {
      list.innerHTML = "";
      noResults.textContent = "The LRC study areas have not been set up yet. "
        + "Please check back later or ask the LRC staff.";
      noResults.hidden = false;
      resultLine.textContent = "No study areas yet.";
      return;
    }

    if (!locks) {
      list.innerHTML = '<p class="loading">Loading live availability for '
                     + NU.fmtDateShort(date) + '...</p>';
      return;
    }

    var booked = bookedSet(locks);
    var matches = facilities.filter(function (f) {
      return (activeType === "all" || f.type === activeType) && capacityMatches(f);
    });

    var html = "";
    var unitCount = 0;

    matches.forEach(function (facility) {
      var units = resources.filter(function (r) {
        return r.facilityId === facility.id && r.status !== "removed";
      });
      unitCount += units.length;

      var views = units.map(function (u) { return unitView(u, date, slot, booked); });
      var freeCount = views.filter(function (v) { return v.bookable; }).length;
      var summaryCls = freeCount === 0 ? "avail-red"
                     : freeCount < units.length / 3 ? "avail-orange" : "avail-green";
      var summary = units.length === 0 ? "No units listed"
        : freeCount + " of " + units.length + " available"
          + (slot === "any" ? "" : " at " + NU.fmtHour(Number(slot)));

      var chips = units.map(function (u, i) {
        var v = views[i];
        var inner = '<b>' + NU.escapeHtml(u.label) + '</b>'
                  + '<span class="u-state">' + v.text + '</span>'
                  + '<span>' + NU.escapeHtml(v.detail || "") + '</span>';
        if (!v.bookable) {
          return '<div class="unit-chip ' + v.cls + '">' + inner + '</div>';
        }
        var href = "../booking/booking.html?resource=" + encodeURIComponent(u.id)
                 + "&date=" + encodeURIComponent(date)
                 + (slot === "any" ? "" : "&hour=" + encodeURIComponent(slot));
        return '<a class="unit-chip free" href="' + href + '" aria-label="Book '
             + NU.escapeHtml(u.label) + ', ' + v.text + ', ' + NU.escapeHtml(v.detail) + '">'
             + inner + '</a>';
      }).join("");

      html +=
        '<article class="facility-card">' +
          '<div class="facility-top">' +
            '<img class="area-photo" src="../images/' + NU.escapeHtml(facility.image || "room-group")
              + '.svg" alt="">' +
            '<div class="area-body">' +
              '<h2 class="area-name">' + NU.escapeHtml(facility.name) +
                (facility.alias ? ' <small>(' + NU.escapeHtml(facility.alias) + ')</small>' : '') +
              '</h2>' +
              '<div class="area-meta">' + NU.escapeHtml(facility.description || "") + '<br>' +
                'Capacity: <b>' + NU.capacityText(facility.capacityPerUnit) + ' per '
                  + (facility.type === "discussion" ? "room" : facility.type === "silent" ? "table" : "computer")
                  + '</b><br>' +
                'Location: <b>' + LOCATION + '</b> &middot; ' + NU.escapeHtml(hoursText(date)) +
              '</div>' +
              '<div class="area-status ' + summaryCls + '">' + summary + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="facility-units">' +
            (units.length ? '<div class="unit-grid">' + chips + '</div>'
                          : '<p class="res-empty">No units are listed in this area right now.</p>') +
          '</div>' +
        '</article>';
    });

    list.innerHTML = html;
    noResults.textContent = "No study areas match these filters. Try another area type or capacity.";
    noResults.hidden = matches.length > 0;

    resultLine.textContent = "Showing " + matches.length
      + (matches.length === 1 ? " study area" : " study areas")
      + " (" + unitCount + (unitCount === 1 ? " unit" : " units") + ") for "
      + NU.fmtDateShort(date)
      + (slot === "any" ? "." : " at " + NU.fmtRange(Number(slot)) + ".");
  }

  /* ---------- upcoming reservations rail ---------- */

  function renderUpcoming(mine) {
    var box = document.getElementById("upcoming");
    var now = Date.now();

    var upcoming = mine
      .filter(function (r) { return ACTIVE_STATUSES.indexOf(r.status) !== -1 && millis(r.end) > now; })
      .sort(function (a, b) { return millis(a.start) - millis(b.start); })
      .slice(0, 3);

    if (!upcoming.length) {
      box.innerHTML = '<p class="res-empty">No upcoming reservations yet.<br>'
                    + 'Pick an available unit to book one.</p>';
      return;
    }

    var today = NU.todayISO();
    box.innerHTML = upcoming.map(function (r) {
      var when = r.date === today ? "Today, " + NU.fmtDateShort(r.date) : NU.fmtDateShort(r.date);
      return '<div class="res-item">' +
               '<div class="res-top">' +
                 '<span class="res-when">' + when + '</span>' +
                 NU.statusBadge(r.status) +
               '</div>' +
               '<div class="res-time">' + NU.fmtRange(r.startHour, r.endHour) + '</div>' +
               '<div class="res-area">' + NU.escapeHtml(r.resourceLabel) + ' &middot; '
                 + NU.escapeHtml(r.facilityName) + '</div>' +
             '</div>';
    }).join("");
  }

  /* ---------- notifications ---------- */

  var unread = [];
  var markBtn = document.getElementById("markReadBtn");
  var unreadBadge = document.getElementById("unreadCount");

  function renderNotifications(items) {
    var box = document.getElementById("notifList");
    unread = items.filter(function (n) { return !n.read; }).map(function (n) { return n.id; });

    unreadBadge.hidden = !unread.length;
    unreadBadge.textContent = unread.length + " new";
    markBtn.hidden = !unread.length;

    if (!items.length) {
      box.innerHTML = '<p class="res-empty">No notifications yet. Updates about your '
                    + 'reservations will appear here.</p>';
      return;
    }
    box.innerHTML = items.slice(0, 6).map(function (n) {
      return '<div class="notif' + (n.read ? "" : " unread") + '">'
           + NU.escapeHtml(n.message)
           + '<time>' + NU.fmtStamp(n.createdAt) + '</time></div>';
    }).join("");
  }

  markBtn.addEventListener("click", async function () {
    markBtn.disabled = true;
    try {
      await markNotificationsRead(unread);
    } catch (err) {
      NU.toast(describeError(err), "bad");
    }
    markBtn.disabled = false;
  });

  /* ---------- go ---------- */

  watchFacilities(function (data) { facilities = data; render(); }, showLoadError);
  watchResources(function (data) { resources = data; render(); }, showLoadError);
  watchSchedule(function (data) {
    schedule = data;
    fillSlots();
    var open = hoursOn(schedule, NU.todayISO());
    document.getElementById("hoursNote").textContent = schedule
      ? "Today: " + (open ? NU.fmtRange(open.openHour, open.closeHour) : "LRC closed")
      : "";
    render();
  }, showLoadError);
  subscribeLocks();

  watchMyReservations(session.uid, renderUpcoming, function (err) {
    document.getElementById("upcoming").innerHTML =
      '<p class="res-empty">' + NU.escapeHtml(describeError(err)) + '</p>';
  });
  watchMyNotifications(session.uid, renderNotifications, function (err) {
    document.getElementById("notifList").innerHTML =
      '<p class="res-empty">' + NU.escapeHtml(describeError(err)) + '</p>';
  });

  // keep "past" slots accurate while the page stays open
  setInterval(render, 60 * 1000);

  var params = new URLSearchParams(window.location.search);
  if (params.get("booked") === "1") {
    NU.toast("Reservation submitted. It is pending LRC staff approval.", "good");
  }
}
