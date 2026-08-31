/* ============================================================
   admin_dashboard.js - LRC staff / administrative dashboard

   Reads the same reservation store the student pages write to,
   so a booking made in booking.html shows up here.
   ============================================================ */

(function () {
  "use strict";

  var session = NU.requireLogin("admin");
  if (!session) return;

  var today = NU.todayISO();

  document.getElementById("staffName").textContent = session.name;
  document.getElementById("staffRole").textContent = session.program;
  document.getElementById("todayLine").textContent = "Current Date, " + NU.fmtDateLong(today);
  NU.bindLogout();

  var soon = document.querySelectorAll("[data-soon]");
  for (var s = 0; s < soon.length; s++) {
    soon[s].addEventListener("click", function (e) {
      e.preventDefault();
      NU.toast("That page is part of a later batch.");
    });
  }

  var search = document.getElementById("search");
  search.addEventListener("input", renderTable);

  /* ---------- stat tiles ---------- */

  function renderStats() {
    var todays = NU.reservationsOn(today);

    var pending = todays.filter(function (r) { return r.status === "Pending"; });
    var active  = todays.filter(function (r) {
      return r.status === "Confirmed" || r.status === "Pending";
    });

    // a study area counts as occupied if it holds a live booking today
    var occupiedIds = {};
    active.forEach(function (r) { occupiedIds[r.areaId] = true; });
    var occupied = Object.keys(occupiedIds).length;

    document.getElementById("statToday").textContent     = todays.length;
    document.getElementById("statPending").textContent   = pending.length;
    document.getElementById("statAvailable").textContent =
      (NU.AREAS.length - occupied) + "/" + NU.AREAS.length;
    document.getElementById("statOccupied").textContent  = occupied;
    document.getElementById("bellCount").textContent     = pending.length;
  }

  /* ---------- today's reservations table ---------- */

  function statusCell(r) {
    if (r.status === "Confirmed") return '<span class="badge badge-ok">Confirmed</span>';
    if (r.status === "Completed") return '<span class="badge badge-mute">Completed</span>';
    if (r.status === "Cancelled") return '<span class="cancelled">Cancelled</span>';
    return '<span class="badge badge-warn">Pending</span>';
  }

  function actionCell(r) {
    if (r.status === "Pending") {
      return '<div class="acts">'
           + '<button class="btn btn-ok btn-sm" data-approve="' + r.id + '">Approve</button>'
           + '<button class="btn btn-danger btn-sm" data-reject="' + r.id + '">Reject</button>'
           + '</div>';
    }
    if (r.status === "Confirmed") {
      return '<button class="btn btn-ghost btn-sm" data-complete="' + r.id + '">Mark Done</button>';
    }
    return '<span class="badge badge-mute">No action</span>';
  }

  function renderTable() {
    var body  = document.getElementById("resBody");
    var query = search.value.trim().toLowerCase();

    var rows = NU.reservationsOn(today).sort(function (a, b) {
      return a.slot.localeCompare(b.slot);
    });

    if (query) {
      rows = rows.filter(function (r) {
        var area = NU.getArea(r.areaId);
        var hay = (r.studentName + " " + r.studentNo + " " + r.purpose + " "
                + (area ? area.name : r.areaId)).toLowerCase();
        return hay.indexOf(query) !== -1;
      });
    }

    document.getElementById("rowCount").textContent =
      rows.length + (rows.length === 1 ? " record" : " records");

    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty" colspan="6">'
                     + 'No reservations match this search.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(function (r) {
      var area = NU.getArea(r.areaId);
      return '<tr>'
           + '<td class="res-time">' + NU.fmtRange(r.slot) + '</td>'
           + '<td>' + NU.escapeHtml(area ? area.name : r.areaId) + '</td>'
           + '<td class="res-student"><b>' + NU.escapeHtml(r.studentName) + '</b>'
             + '<span>' + NU.escapeHtml(r.studentNo) + '</span></td>'
           + '<td>' + NU.escapeHtml(r.purpose) + '</td>'
           + '<td>' + statusCell(r) + '</td>'
           + '<td>' + actionCell(r) + '</td>'
           + '</tr>';
    }).join("");

    wireRowButtons();
  }

  function wireRowButtons() {
    bind("data-approve",  "Confirmed", "Reservation approved.", "good");
    bind("data-reject",   "Cancelled", "Reservation rejected.", "bad");
    bind("data-complete", "Completed", "Marked as completed.", null);
  }

  function bind(attr, status, message, kind) {
    var buttons = document.querySelectorAll("[" + attr + "]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function () {
        NU.setStatus(this.getAttribute(attr), status);
        NU.toast(message, kind);
        renderAll();
      });
    }
  }

  /* ---------- study area availability ---------- */

  function renderAvailability() {
    var grid = document.getElementById("availGrid");

    grid.innerHTML = NU.AREAS.map(function (area) {
      var live = NU.reservationsOn(today).filter(function (r) {
        return r.areaId === area.id
            && (r.status === "Confirmed" || r.status === "Pending");
      });

      var cls, label;
      if (area.status === "full") {
        cls = "closed"; label = "Unavailable";
      } else if (live.length >= 3) {
        cls = "held"; label = "Occupied";
      } else if (live.length > 0) {
        cls = "busy"; label = "Reserved (" + live.length + ")";
      } else {
        cls = "free"; label = "Available";
      }

      return '<div class="avail-cell ' + cls + '">'
           + '<span class="avail-name">' + NU.escapeHtml(area.id) + '</span>'
           + label + '</div>';
    }).join("");
  }

  /* ---------- weekly utilization chart ---------- */

  function renderChart() {
    var labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    // Booking counts for the past week. Today's column is live, the
    // rest stand in for records the LRC already has on file.
    var counts = [18, 12, 20, 24, 15, 6];
    counts[3] = NU.reservationsOn(today).length + 14;

    var max = Math.max.apply(null, counts);
    var peak = counts.indexOf(max);

    var axis = '<div class="chart-axis">'
             + '<span>' + max + '</span><span>' + Math.round(max / 2) + '</span><span>0</span>'
             + '</div>';

    var plot = '<div class="chart-plot">' + counts.map(function (n, i) {
      var height = Math.round((n / max) * 100);
      return '<div class="chart-col" title="' + labels[i] + ': ' + n + ' bookings">'
           + '<div class="chart-bar' + (i === peak ? " peak" : "")
             + '" style="height:' + height + '%"></div>'
           + '<span class="chart-day">' + labels[i] + '</span>'
           + '</div>';
    }).join("") + '</div>';

    document.getElementById("chart").innerHTML = axis + plot;
  }

  /* ---------- go ---------- */

  function renderAll() {
    renderStats();
    renderTable();
    renderAvailability();
    renderChart();
  }

  renderAll();
})();
