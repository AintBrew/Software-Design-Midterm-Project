/* ============================================================
   booking.js - LRC booking menu

   Pick a date on the calendar, pick a time slot, then confirm.
   Slots already reserved for that study area and date are locked
   so two students cannot take the same one (FR-04).
   ============================================================ */

(function () {
  "use strict";

  var session = NU.requireLogin("student");
  if (!session) return;

  document.getElementById("userName").textContent = session.name;
  document.getElementById("userId").textContent   = "ID: " + session.studentNo;
  NU.bindLogout();

  /* ---------- what are we booking ---------- */

  var params = new URLSearchParams(window.location.search);
  var area = NU.getArea(params.get("area")) || NU.AREAS[0];

  var selectedDate = params.get("date") || NU.todayISO();
  if (selectedDate < NU.todayISO()) selectedDate = NU.todayISO();

  var selectedSlot = null;

  // month currently shown in the calendar
  var viewYear, viewMonth;
  (function () {
    var p = selectedDate.split("-");
    viewYear  = Number(p[0]);
    viewMonth = Number(p[1]) - 1;
  })();

  /* ---------- study area header ---------- */

  document.getElementById("pickPhoto").src = "../images/" + area.image + ".svg";
  document.getElementById("pickName").textContent = area.name;
  document.getElementById("pickCapacity").textContent =
    "Capacity: " + area.capacity + (area.capacity === 1 ? " student" : " students");
  document.getElementById("pickLocation").textContent = "Location: " + area.location;

  /* ---------- calendar ---------- */

  var calDays  = document.getElementById("calDays");
  var calTitle = document.getElementById("calTitle");
  var prevBtn  = document.getElementById("prevMonth");
  var nextBtn  = document.getElementById("nextMonth");

  function renderCalendar() {
    calTitle.textContent = NU.MONTHS[viewMonth] + " " + viewYear;
    calDays.innerHTML = "";

    var today = NU.todayISO();
    var first = new Date(viewYear, viewMonth, 1);
    var lead  = first.getDay();
    var count = new Date(viewYear, viewMonth + 1, 0).getDate();

    // blank cells before the 1st
    for (var b = 0; b < lead; b++) {
      var blank = document.createElement("span");
      calDays.appendChild(blank);
    }

    for (var d = 1; d <= count; d++) {
      var iso = NU.toISO(new Date(viewYear, viewMonth, d));
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      btn.textContent = d;
      btn.setAttribute("data-date", iso);

      if (iso < today) {
        btn.disabled = true;                    // no booking in the past
      } else {
        btn.addEventListener("click", function () {
          selectedDate = this.getAttribute("data-date");
          selectedSlot = null;
          renderCalendar();
          renderSlots();
          renderSummary();
        });
      }
      if (iso === today)        btn.classList.add("today");
      if (iso === selectedDate) btn.classList.add("on");

      calDays.appendChild(btn);
    }

    // do not page back before the current month
    var now = new Date();
    prevBtn.disabled = (viewYear === now.getFullYear() && viewMonth === now.getMonth());
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

  var slotList  = document.getElementById("slotList");
  var slotsTitle = document.getElementById("slotsTitle");

  function renderSlots() {
    slotsTitle.textContent = "Available Time Slots for " + NU.fmtDateLong(selectedDate);
    slotList.innerHTML = "";

    NU.SLOTS.forEach(function (slot) {
      var blocked = NU.isSlotBlocked(area.id, slot);
      var taken   = !blocked && NU.isSlotTaken(area.id, selectedDate, slot);

      var row = document.createElement("div");
      row.className = "slot-row";

      var time = document.createElement("span");
      time.className = "slot-time";
      time.textContent = NU.fmtSlot(slot);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";

      if (blocked) {
        btn.classList.add("blocked");
        btn.disabled = true;
        btn.textContent = "Unavailable";
      } else if (taken) {
        btn.classList.add("taken");
        btn.disabled = true;
        btn.textContent = "Reserved";
      } else if (slot === selectedSlot) {
        btn.classList.add("on");
        btn.textContent = "Selected";
      } else {
        btn.textContent = "Available";
      }

      if (!blocked && !taken) {
        btn.addEventListener("click", function () {
          selectedSlot = slot;
          renderSlots();
          renderSummary();
        });
      }

      row.appendChild(time);
      row.appendChild(btn);
      slotList.appendChild(row);
    });
  }

  /* ---------- summary ---------- */

  var confirmBtn = document.getElementById("confirmBtn");

  function renderSummary() {
    document.getElementById("sumArea").textContent = area.name;
    document.getElementById("sumDate").textContent = NU.fmtDateLong(selectedDate);
    document.getElementById("sumTime").textContent =
      selectedSlot ? NU.fmtRange(selectedSlot) : "Select a time slot";

    confirmBtn.classList.toggle("is-disabled", !selectedSlot);
  }

  /* ---------- confirmation dialog ---------- */

  var veil = document.getElementById("confirmVeil");
  var agree = document.getElementById("agree");
  var agreeErr = document.getElementById("agreeErr");

  confirmBtn.addEventListener("click", function () {
    if (!selectedSlot) return;

    document.getElementById("dlgArea").textContent     = area.name;
    document.getElementById("dlgLocation").textContent = area.location;
    document.getElementById("dlgDate").textContent     = NU.fmtDateLong(selectedDate);
    document.getElementById("dlgTime").textContent     = NU.fmtRange(selectedSlot);
    document.getElementById("dlgPurpose").textContent  =
      document.getElementById("purpose").value;

    agree.checked = false;
    agreeErr.classList.remove("show");
    veil.hidden = false;
  });

  document.getElementById("cancelBtn").addEventListener("click", function () {
    veil.hidden = true;
  });

  veil.addEventListener("click", function (e) {
    if (e.target === veil) veil.hidden = true;
  });

  agree.addEventListener("change", function () {
    if (agree.checked) agreeErr.classList.remove("show");
  });

  document.getElementById("submitBtn").addEventListener("click", function () {
    if (!agree.checked) {
      agreeErr.textContent = "Please confirm you have reviewed the details before submitting.";
      agreeErr.classList.add("show");
      return;
    }

    // last check in case the slot was taken while this page was open
    if (NU.isSlotTaken(area.id, selectedDate, selectedSlot)) {
      veil.hidden = true;
      NU.toast("That slot was just reserved by someone else. Please pick another.", "bad");
      selectedSlot = null;
      renderSlots();
      renderSummary();
      return;
    }

    NU.addReservation({
      areaId: area.id,
      date: selectedDate,
      slot: selectedSlot,
      studentName: session.name,
      studentNo: session.studentNo,
      purpose: document.getElementById("purpose").value,
      status: "Pending"
    });

    window.location.href = "../main_dashboard/main_dashboard.html?booked=1";
  });

  /* ---------- go ---------- */

  renderCalendar();
  renderSlots();
  renderSummary();
})();
