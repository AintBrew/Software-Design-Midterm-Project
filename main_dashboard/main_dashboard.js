/* ============================================================
   main_dashboard.js - Find a Study Area (student dashboard)

   Front end only. Study areas and reservations come from
   shared/nu-data.js.
   ============================================================ */

(function () {
  "use strict";

  var session = NU.requireLogin("student");
  if (!session) return;                 // redirecting, stop here

  /* ---------- header ---------- */

  document.getElementById("userName").textContent = session.name;
  document.getElementById("userId").textContent   = "ID: " + session.studentNo;
  NU.bindLogout();

  // nav items whose pages are not built yet
  var soon = document.querySelectorAll("[data-soon]");
  for (var s = 0; s < soon.length; s++) {
    soon[s].addEventListener("click", function (e) {
      e.preventDefault();
      NU.toast("That page is part of the next batch.");
    });
  }

  /* ---------- filter controls ---------- */

  var dateInput = document.getElementById("date");
  var slotSelect = document.getElementById("slot");
  var capSelect = document.getElementById("capacity");
  var grid = document.getElementById("areaGrid");
  var resultLine = document.getElementById("resultLine");
  var noResults = document.getElementById("noResults");

  var activeType = "All";

  dateInput.value = NU.todayISO();
  dateInput.min = NU.todayISO();

  // fill the time slot dropdown from the shared slot list
  NU.SLOTS.forEach(function (slot) {
    var option = document.createElement("option");
    option.value = slot;
    option.textContent = NU.fmtRange(slot);
    slotSelect.appendChild(option);
  });

  var segButtons = document.querySelectorAll("#typeSeg button");
  for (var b = 0; b < segButtons.length; b++) {
    segButtons[b].addEventListener("click", function () {
      for (var i = 0; i < segButtons.length; i++) {
        segButtons[i].classList.remove("on");
      }
      this.classList.add("on");
      activeType = this.getAttribute("data-type");
      render();
    });
  }

  capSelect.addEventListener("change", render);
  dateInput.addEventListener("change", render);
  slotSelect.addEventListener("change", render);

  document.getElementById("searchBtn").addEventListener("click", function () {
    render();
    NU.toast("Filters applied.");
  });

  document.getElementById("resetBtn").addEventListener("click", function () {
    activeType = "All";
    for (var i = 0; i < segButtons.length; i++) {
      segButtons[i].classList.toggle("on", segButtons[i].getAttribute("data-type") === "All");
    }
    capSelect.value = "any";
    slotSelect.value = "any";
    dateInput.value = NU.todayISO();
    render();
  });

  /* ---------- helpers ---------- */

  function capacityMatches(area, band) {
    if (band === "any")  return true;
    if (band === "1-2")  return area.capacity <= 2;
    if (band === "3-6")  return area.capacity >= 3 && area.capacity <= 6;
    if (band === "7+")   return area.capacity >= 7;
    return true;
  }

  // What the card should say for the chosen date and slot.
  function availability(area, date, slot) {
    if (slot === "any") {
      if (area.status === "full")    return { cls: "avail-red",    text: "Fully Booked" };
      if (area.status === "limited") return { cls: "avail-orange", text: "Limited Availability" };
      return { cls: "avail-green", text: "Available" };
    }
    if (NU.isSlotBlocked(area.id, slot)) {
      return { cls: "avail-red", text: "Unavailable at this time" };
    }
    if (NU.isSlotTaken(area.id, date, slot)) {
      return { cls: "avail-red", text: "Reserved at this time" };
    }
    return { cls: "avail-green", text: "Available at this time" };
  }

  /* ---------- render the area cards ---------- */

  function render() {
    var date = dateInput.value || NU.todayISO();
    var slot = slotSelect.value;

    var matches = NU.AREAS.filter(function (area) {
      var typeOk = activeType === "All" || area.type === activeType;
      return typeOk && capacityMatches(area, capSelect.value);
    });

    grid.innerHTML = "";

    matches.forEach(function (area) {
      var state = availability(area, date, slot);
      var bookable = state.cls !== "avail-red";

      var card = document.createElement("article");
      card.className = "area-card";
      card.innerHTML =
        '<img class="area-photo" src="../images/' + area.image + '.svg" alt="">' +
        '<div class="area-body">' +
          '<div class="area-name">' + NU.escapeHtml(area.name) + '</div>' +
          '<div class="area-meta">Capacity: <b>' + area.capacity +
            (area.capacity === 1 ? ' seat' : ' seats') + '</b><br>' +
            'Type: <b>' + NU.escapeHtml(area.type) + ' Study</b></div>' +
          '<div class="area-status ' + state.cls + '">' + state.text + '</div>' +
          '<div class="area-hours">' + NU.escapeHtml(area.hours) + '</div>' +
          '<div class="area-foot">' +
            (bookable
              ? '<a class="btn btn-primary btn-sm" href="../booking/booking.html?area='
                + encodeURIComponent(area.id) + '&date=' + encodeURIComponent(date)
                + '">Book Now</a>'
              : '<span class="btn btn-sm is-disabled">Unavailable</span>') +
          '</div>' +
        '</div>';
      grid.appendChild(card);
    });

    noResults.hidden = matches.length > 0;

    var label = matches.length === 1 ? "study area" : "study areas";
    resultLine.textContent = "Showing " + matches.length + " " + label
      + " for " + NU.fmtDateShort(date)
      + (slot === "any" ? "." : " at " + NU.fmtRange(slot) + ".");
  }

  /* ---------- upcoming reservations rail ---------- */

  function renderUpcoming() {
    var box = document.getElementById("upcoming");
    var today = NU.todayISO();

    var mine = NU.reservationsFor(session.studentNo)
      .filter(function (r) {
        return r.date >= today && r.status !== "Cancelled" && r.status !== "Completed";
      })
      .sort(function (a, b) {
        return (a.date + a.slot).localeCompare(b.date + b.slot);
      })
      .slice(0, 3);

    if (!mine.length) {
      box.innerHTML = '<p class="res-empty">No upcoming reservations yet.<br>'
                    + 'Pick a study area to book one.</p>';
      return;
    }

    box.innerHTML = mine.map(function (r) {
      var area = NU.getArea(r.areaId);
      var when = r.date === today ? "Today, " + NU.fmtDateShort(r.date)
                                  : NU.fmtDateShort(r.date);
      var badge = r.status === "Confirmed" ? "badge-ok" : "badge-warn";
      return '<div class="res-item">' +
               '<div class="res-top">' +
                 '<span class="res-when">' + when + '</span>' +
                 '<span class="badge ' + badge + '">' + r.status + '</span>' +
               '</div>' +
               '<div class="res-time">' + NU.fmtRange(r.slot) + '</div>' +
               '<div class="res-area">' + NU.escapeHtml(area ? area.name : r.areaId) + '</div>' +
             '</div>';
    }).join("");
  }

  /* ---------- go ---------- */

  render();
  renderUpcoming();

  // a booking made on the booking page announces itself here
  var params = new URLSearchParams(window.location.search);
  if (params.get("booked") === "1") {
    NU.toast("Reservation submitted. Check your upcoming reservations.", "good");
  }
})();
