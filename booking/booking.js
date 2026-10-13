/* ============================================================
   booking.js - LRC booking menu

   Pick a unit, a date on the calendar, a time slot, and a
   duration, then confirm. Availability is live from Firestore;
   the booking itself is a Firestore transaction that re-checks
   every slot, so two students can never hold the same unit and
   hour (FR-04). Success is shown only after Firebase confirms.
   ============================================================ */

import {
  requireRole, signOutUser, describeError, LOCATION, MAX_BOOKING_HOURS,
  watchFacilities, watchResources, watchSchedule, watchSlotLocks,
  hoursOn, bookedSet, slotStates, createReservation
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
  document.getElementById("userName").textContent = session.name;
  document.getElementById("userId").textContent   = "ID: " + session.studentNo;
  document.querySelectorAll("[data-logout]").forEach(function (link) {
    link.addEventListener("click", async function (e) {
      e.preventDefault();
      await signOutUser();
      window.location.href = "../login/login.html";
    });
  });

  /* ---------- page state ---------- */

  var params = new URLSearchParams(window.location.search);
  var facilities = null;
  var resources = null;
  var schedule;                      // undefined until loaded
  var locks = null;
  var stopLocks = null;

  var unit = null;                   // selected resource
  var facility = null;
  var selectedDate = params.get("date") || NU.todayISO();
  if (selectedDate < NU.todayISO()) selectedDate = NU.todayISO();
  var selectedStart = params.get("hour") !== null ? Number(params.get("hour")) : null;
  var wantedResource = params.get("resource");

  var viewYear = Number(selectedDate.slice(0, 4));
  var viewMonth = Number(selectedDate.slice(5, 7)) - 1;

  var durationSelect = document.getElementById("duration");
  var facilitySelect = document.getElementById("facilitySelect");
  var unitSelect = document.getElementById("unitSelect");
  var slotErr = document.getElementById("slotErr");

  function hours() {
    return Number(durationSelect.value);
  }

  function setSlotError(message) {
    slotErr.textContent = message || "";
    slotErr.classList.toggle("show", !!message);
  }

  /* ---------- unit picker ---------- */

  function activeUnits(facilityId) {
    return resources.filter(function (r) {
      return r.facilityId === facilityId && r.status !== "removed";
    });
  }

  function chooseUnit(resource) {
    unit = resource;
    facility = facilities.filter(function (f) { return f.id === resource.facilityId; })[0] || null;
    selectedStart = selectedStart !== null && unit ? selectedStart : null;
    renderPicker();
    renderHeader();
    renderGroupSection();
    renderSlots();
    renderSummary();
  }

  function renderPicker() {
    facilitySelect.innerHTML = facilities.map(function (f) {
      return '<option value="' + NU.escapeHtml(f.id) + '">' + NU.escapeHtml(f.name) + '</option>';
    }).join("");
    facilitySelect.value = unit.facilityId;

    unitSelect.innerHTML = activeUnits(unit.facilityId).map(function (r) {
      return '<option value="' + NU.escapeHtml(r.id) + '">' + NU.escapeHtml(r.label)
           + (r.status === "maintenance" ? " (unavailable)" : "") + '</option>';
    }).join("");
    unitSelect.value = unit.id;

    facilitySelect.disabled = false;
    unitSelect.disabled = false;
  }

  facilitySelect.addEventListener("change", function () {
    var units = activeUnits(facilitySelect.value);
    var firstOpen = units.filter(function (r) { return r.status === "active"; })[0] || units[0];
    if (!firstOpen) {
      NU.toast("No units are listed in that area right now.", "bad");
      facilitySelect.value = unit.facilityId;
      return;
    }
    selectedStart = null;
    chooseUnit(firstOpen);
  });

  unitSelect.addEventListener("change", function () {
    var next = resources.filter(function (r) { return r.id === unitSelect.value; })[0];
    if (next) {
      selectedStart = null;
      chooseUnit(next);
    }
  });

  function renderHeader() {
    document.getElementById("pickPhoto").src = "../images/" + ((facility && facility.image) || "room-group") + ".svg";
    document.getElementById("pickName").textContent = unit.label;
    document.getElementById("pickFacility").textContent = "Study area: " + unit.facilityName
      + (facility && facility.alias ? " (" + facility.alias + ")" : "");
    document.getElementById("pickCapacity").textContent = "Capacity: " + NU.capacityText(unit.capacity);
    document.getElementById("pickLocation").textContent = "Location: " + LOCATION;
    document.title = "Book " + unit.label + " · NU Fairview LRC Booking";
  }

  /* ---------- calendar ---------- */

  var calDays  = document.getElementById("calDays");
  var calTitle = document.getElementById("calTitle");
  var prevBtn  = document.getElementById("prevMonth");
  var nextBtn  = document.getElementById("nextMonth");

  function renderCalendar() {
    calTitle.textContent = NU.MONTHS[viewMonth] + " " + viewYear;
    calDays.innerHTML = "";

    var today = NU.todayISO();
    var lead  = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
    var count = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

    for (var b = 0; b < lead; b++) calDays.appendChild(document.createElement("span"));

    for (var d = 1; d <= count; d++) {
      var iso = NU.toISO(viewYear, viewMonth, d);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      btn.textContent = d;
      btn.setAttribute("data-date", iso);

      var closed = schedule !== undefined && !hoursOn(schedule, iso);
      if (iso < today || closed) {
        btn.disabled = true;
        btn.setAttribute("aria-label", NU.fmtDateLong(iso) + (iso < today ? ", past" : ", LRC closed"));
      } else {
        btn.setAttribute("aria-label", NU.fmtDateLong(iso));
        btn.addEventListener("click", function () {
          selectedDate = this.getAttribute("data-date");
          selectedStart = null;
          setSlotError("");
          renderCalendar();
          subscribeLocks();
          renderSummary();
        });
      }
      if (iso === today) btn.classList.add("today");
      if (iso === selectedDate) {
        btn.classList.add("on");
        btn.setAttribute("aria-pressed", "true");
      }
      calDays.appendChild(btn);
    }

    var todayParts = NU.todayISO().split("-").map(Number);
    prevBtn.disabled = (viewYear === todayParts[0] && viewMonth === todayParts[1] - 1);
  }

  prevBtn.addEventListener("click", function () {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });

  nextBtn.addEventListener("click", function () {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });

  /* ---------- time slots ---------- */

  var slotList   = document.getElementById("slotList");
  var slotsTitle = document.getElementById("slotsTitle");

  function currentStates() {
    if (!unit || !locks || schedule === undefined) return null;
    return slotStates(unit, schedule, bookedSet(locks), selectedDate);
  }

  function stateAt(states, hour) {
    var s = states.filter(function (x) { return x.hour === hour; })[0];
    return s ? s.state : "closed";
  }

  // A range is bookable when every hour in it is free.
  function rangeFree(states, startHour, length) {
    for (var h = startHour; h < startHour + length; h++) {
      if (stateAt(states, h) !== "free") return false;
    }
    return true;
  }

  function renderSlots() {
    slotsTitle.textContent = "Available Time Slots for " + NU.fmtDateLong(selectedDate);
    var states = currentStates();
    if (!states) {
      slotList.innerHTML = '<p class="loading">Loading live availability...</p>';
      return;
    }
    if (!states.length) {
      slotList.innerHTML = '<p class="slot-empty">The LRC is closed on this day. Pick another date.</p>';
      return;
    }
    if (unit.status !== "active") {
      setSlotError("");
      slotList.innerHTML = '<p class="slot-empty">' + NU.escapeHtml(unit.label)
        + ' is temporarily unavailable' + (unit.statusNote ? " (" + NU.escapeHtml(unit.statusNote) + ")" : "")
        + '. Choose another unit.</p>';
      return;
    }

    // a selection taken by someone else in the meantime is dropped
    if (selectedStart !== null && !rangeFree(states, selectedStart, hours())) {
      if (stateAt(states, selectedStart) === "reserved" || stateAt(states, selectedStart + 1) === "reserved") {
        NU.toast("Your selected time was just reserved by someone else. Please pick another.", "bad");
      }
      selectedStart = null;
    }

    slotList.innerHTML = "";
    states.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "slot-row";

      var time = document.createElement("span");
      time.className = "slot-time";
      time.textContent = NU.fmtHour(s.hour);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";
      var inRange = selectedStart !== null && s.hour >= selectedStart && s.hour < selectedStart + hours();

      if (s.state === "reserved") {
        btn.classList.add("taken");
        btn.disabled = true;
        btn.textContent = "Reserved";
      } else if (s.state === "past" || s.state === "unavailable") {
        btn.classList.add(s.state === "past" ? "past" : "blocked");
        btn.disabled = true;
        btn.textContent = "Unavailable";
      } else if (inRange) {
        btn.classList.add("on");
        btn.textContent = "Selected";
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.textContent = "Available";
        btn.setAttribute("aria-pressed", "false");
      }
      btn.setAttribute("aria-label", NU.fmtRange(s.hour) + ": " + btn.textContent);

      if (s.state === "free") {
        btn.addEventListener("click", function () {
          if (!rangeFree(states, s.hour, hours())) {
            setSlotError("A " + hours() + "-hour booking needs " + NU.fmtRange(s.hour, s.hour + hours())
              + " to be free and within LRC hours. Pick another start time or choose 1 hour.");
            return;
          }
          setSlotError("");
          selectedStart = s.hour;
          renderSlots();
          renderSummary();
        });
      }

      row.appendChild(time);
      row.appendChild(btn);
      slotList.appendChild(row);
    });
  }

  durationSelect.addEventListener("change", function () {
    var states = currentStates();
    if (selectedStart !== null && states && !rangeFree(states, selectedStart, hours())) {
      setSlotError("The next hour after " + NU.fmtHour(selectedStart)
        + " is not free. Pick a start time with two open hours in a row.");
      selectedStart = null;
    } else {
      setSlotError("");
    }
    renderSlots();
    renderSummary();
  });

  function subscribeLocks() {
    if (stopLocks) stopLocks();
    locks = null;
    renderSlots();
    stopLocks = watchSlotLocks(selectedDate, function (data) {
      locks = data;
      renderSlots();
      renderSummary();
    }, showLoadError);
  }

  /* ---------- attendees (discussion rooms) ---------- */

  var groupSection = document.getElementById("groupSection");
  var attendeeList = document.getElementById("attendeeList");
  var addBtn = document.getElementById("addAttendee");
  var attendeeErr = document.getElementById("attendeeErr");
  var attendeeSeq = 0;

  function maxAttendees() {
    return unit ? unit.capacity - 1 : 0;
  }

  function attendeeRows() {
    return Array.prototype.slice.call(attendeeList.querySelectorAll(".attendee-row"));
  }

  function renderGroupSection() {
    var isGroup = unit && unit.type === "discussion" && unit.capacity > 1;
    groupSection.hidden = !isGroup;
    if (!isGroup) {
      attendeeList.innerHTML = "";
    } else {
      // drop extra rows if the new room is smaller
      attendeeRows().slice(maxAttendees()).forEach(function (row) { row.remove(); });
    }
    document.getElementById("maxAttendees").textContent = String(maxAttendees());
    updateGroupSize();
  }

  function addAttendeeRow(focus) {
    if (attendeeRows().length >= maxAttendees()) return;
    attendeeSeq++;
    var row = document.createElement("div");
    row.className = "attendee-row";
    row.innerHTML =
      '<label class="sr-only" for="attName' + attendeeSeq + '">Attendee name</label>' +
      '<input class="input att-name" id="attName' + attendeeSeq + '" type="text" placeholder="Full name" autocomplete="off">' +
      '<label class="sr-only" for="attNo' + attendeeSeq + '">Attendee student number</label>' +
      '<input class="input att-no" id="attNo' + attendeeSeq + '" type="text" placeholder="2023-123456" inputmode="numeric" autocomplete="off">' +
      '<button type="button" class="remove" aria-label="Remove this attendee">Remove</button>';
    row.querySelector(".remove").addEventListener("click", function () {
      row.remove();
      updateGroupSize();
      addBtn.focus();
    });
    row.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("input", function () {
        input.classList.remove("bad");
        attendeeErr.classList.remove("show");
      });
    });
    attendeeList.appendChild(row);
    updateGroupSize();
    if (focus) row.querySelector(".att-name").focus();
  }

  addBtn.addEventListener("click", function () { addAttendeeRow(true); });

  function updateGroupSize() {
    var count = attendeeRows().length;
    var label = document.getElementById("groupSize");
    label.textContent = "Group size: " + (count + 1) + " of " + (unit ? unit.capacity : 8)
      + " (you + " + count + (count === 1 ? " attendee)" : " attendees)");
    addBtn.disabled = count >= maxAttendees();
    addBtn.classList.toggle("is-disabled", count >= maxAttendees());
    addBtn.textContent = count >= maxAttendees() ? "Room is full" : "+ Add attendee";
  }

  // Returns the attendee list, or null after showing what to fix.
  function collectAttendees() {
    if (groupSection.hidden) return [];
    var rows = attendeeRows();
    var list = [];
    var problem = null;
    var seen = {};

    rows.forEach(function (row) {
      var nameInput = row.querySelector(".att-name");
      var noInput = row.querySelector(".att-no");
      var name = nameInput.value.trim();
      var no = noInput.value.trim();
      if (name.length < 2) {
        nameInput.classList.add("bad");
        problem = problem || "Enter a name for every attendee, or remove empty rows.";
      }
      if (!/^\d{4}-\d{6}$/.test(no)) {
        noInput.classList.add("bad");
        problem = problem || "Every attendee needs a student number in the format 2023-123456.";
      } else if (no === session.studentNo) {
        noInput.classList.add("bad");
        problem = problem || "Do not list yourself - you are already counted in the group.";
      } else if (seen[no]) {
        noInput.classList.add("bad");
        problem = problem || "Each attendee should be listed only once.";
      }
      seen[no] = true;
      list.push({ name: name, studentNo: no });
    });

    if (list.length + 1 > unit.capacity) {
      problem = "This room holds up to " + unit.capacity + " people including you.";
    }
    if (problem) {
      attendeeErr.textContent = problem;
      attendeeErr.classList.add("show");
      var bad = attendeeList.querySelector(".bad");
      if (bad) bad.focus();
      return null;
    }
    attendeeErr.classList.remove("show");
    return list;
  }

  /* ---------- summary ---------- */

  var confirmBtn = document.getElementById("confirmBtn");

  function timeText() {
    return selectedStart === null ? "Select a time slot"
      : NU.fmtRange(selectedStart, selectedStart + hours());
  }

  function renderSummary() {
    document.getElementById("sumArea").textContent = unit ? unit.facilityName : "-";
    document.getElementById("sumUnit").textContent = unit ? unit.label : "-";
    document.getElementById("sumDate").textContent = NU.fmtDateLong(selectedDate);
    document.getElementById("sumTime").textContent = timeText();

    var ready = selectedStart !== null && unit && unit.status === "active";
    confirmBtn.classList.toggle("is-disabled", !ready);
    confirmBtn.setAttribute("aria-disabled", ready ? "false" : "true");
  }

  /* ---------- confirmation dialog ---------- */

  var veil = document.getElementById("confirmVeil");
  var agree = document.getElementById("agree");
  var agreeErr = document.getElementById("agreeErr");
  var submitBtn = document.getElementById("submitBtn");
  var pendingAttendees = [];

  confirmBtn.addEventListener("click", function () {
    if (selectedStart === null || !unit) return;
    var attendees = collectAttendees();
    if (!attendees) return;
    pendingAttendees = attendees;

    document.getElementById("dlgFacility").textContent = unit.facilityName;
    document.getElementById("dlgArea").textContent     = unit.label;
    document.getElementById("dlgLocation").textContent = LOCATION;
    document.getElementById("dlgCapacity").textContent = NU.capacityText(unit.capacity);
    document.getElementById("dlgDate").textContent     = NU.fmtDateLong(selectedDate);
    document.getElementById("dlgTime").textContent     = timeText();
    document.getElementById("dlgDuration").textContent = NU.fmtDuration(hours());
    document.getElementById("dlgPurpose").textContent  = document.getElementById("purpose").value;
    document.getElementById("dlgGroup").textContent    = (attendees.length + 1)
      + (attendees.length ? " (you + " + attendees.length + ")" : " (just you)");

    var showAttendees = unit.type === "discussion";
    document.getElementById("dlgAttendeesLabel").hidden = !showAttendees;
    var dd = document.getElementById("dlgAttendees");
    dd.hidden = !showAttendees;
    dd.innerHTML = attendees.length
      ? '<ul class="attendee-names">' + attendees.map(function (a) {
          return '<li>' + NU.escapeHtml(a.name) + ' (' + NU.escapeHtml(a.studentNo) + ')</li>';
        }).join("") + '</ul>'
      : "None - just you";

    agree.checked = false;
    agreeErr.classList.remove("show");
    veil.hidden = false;
    agree.focus();
  });

  function closeDialog() {
    veil.hidden = true;
    confirmBtn.focus();
  }

  document.getElementById("cancelBtn").addEventListener("click", closeDialog);

  veil.addEventListener("click", function (e) {
    if (e.target === veil && !submitBtn.disabled) closeDialog();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !veil.hidden && !submitBtn.disabled) closeDialog();
  });

  agree.addEventListener("change", function () {
    if (agree.checked) agreeErr.classList.remove("show");
  });

  submitBtn.addEventListener("click", async function () {
    if (!agree.checked) {
      agreeErr.textContent = "Please confirm you have reviewed the details before submitting.";
      agreeErr.classList.add("show");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
    agreeErr.classList.remove("show");

    try {
      await createReservation({
        profile: session,
        resource: unit,
        date: selectedDate,
        startHour: selectedStart,
        hours: hours(),
        purpose: document.getElementById("purpose").value,
        attendees: pendingAttendees
      });
      // Firestore has confirmed the write
      window.location.href = "../main_dashboard/main_dashboard.html?booked=1";
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm Reservation";
      var code = err && err.code;
      if (code === "lrc/conflict" || code === "lrc/unavailable-unit" || code === "lrc/past"
          || code === "lrc/outside-hours") {
        veil.hidden = true;
        selectedStart = null;
        setSlotError(describeError(err));
        renderSlots();
        renderSummary();
        NU.toast(describeError(err), "bad");
      } else {
        agreeErr.textContent = "Your reservation was not saved. " + describeError(err);
        agreeErr.classList.add("show");
      }
    }
  });

  /* ---------- go ---------- */

  function ready() {
    if (!facilities || !resources || schedule === undefined) return;
    if (!unit) {
      var listed = resources.filter(function (r) { return r.status !== "removed"; });
      var wanted = listed.filter(function (r) { return r.id === wantedResource; })[0];
      var fallback = listed.filter(function (r) { return r.status === "active"; })[0] || listed[0];
      if (!wanted && !fallback) {
        document.getElementById("pickName").textContent = "No study areas yet";
        slotList.innerHTML = '<p class="slot-empty">The LRC study areas have not been set up yet. '
          + 'Please check back later or ask the LRC staff.</p>';
        return;
      }
      if (wantedResource && !wanted) {
        NU.toast("That unit is no longer listed. Showing another unit instead.", "bad");
        selectedStart = null;
      }
      chooseUnit(wanted || fallback);
      subscribeLocks();
    } else {
      // pick up live changes to the selected unit (e.g. maintenance)
      var fresh = resources.filter(function (r) { return r.id === unit.id; })[0];
      if (fresh) unit = fresh;
      renderPicker();
      renderHeader();
      renderSlots();
      renderSummary();
    }
  }

  durationSelect.innerHTML = "";
  for (var h = 1; h <= MAX_BOOKING_HOURS; h++) {
    durationSelect.insertAdjacentHTML("beforeend",
      '<option value="' + h + '">' + NU.fmtDuration(h) + '</option>');
  }

  watchFacilities(function (data) { facilities = data; ready(); }, showLoadError);
  watchResources(function (data) { resources = data; ready(); }, showLoadError);
  watchSchedule(function (data) {
    schedule = data;
    var open = hoursOn(schedule, selectedDate);
    if (!open && selectedDate === NU.todayISO()) {
      // start on the next open day instead of a closed one
      for (var i = 1; i <= 14; i++) {
        var next = NU.shiftISO(NU.todayISO(), i);
        if (hoursOn(schedule, next)) {
          selectedDate = next;
          viewYear = Number(next.slice(0, 4));
          viewMonth = Number(next.slice(5, 7)) - 1;
          break;
        }
      }
    }
    document.getElementById("hoursLine").textContent = hoursSummary(schedule);
    renderCalendar();
    if (unit) subscribeLocks();
    ready();
  }, showLoadError);
  renderCalendar();
  renderSummary();

  setInterval(function () { renderSlots(); }, 60 * 1000);
}

// "LRC hours: Mon-Fri 7:00 AM - 7:00 PM, Sat ..."
function hoursSummary(schedule) {
  if (!schedule || !schedule.days) return "";
  var names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var parts = [];
  for (var d = 1; d <= 7; d++) {
    var day = schedule.days[String(d)];
    parts.push(names[d] + " " + (day && day.open ? NU.fmtRange(day.openHour, day.closeHour) : "closed"));
  }
  return "LRC hours (NU Fairview time): " + parts.join(", ") + ".";
}
