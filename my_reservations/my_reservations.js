(function () {
  "use strict";

  var session = NU.requireLogin("student");
  if (!session) return;

  document.getElementById("userName").textContent = session.name;
  document.getElementById("userId").textContent = "ID: " + session.studentNo;
  NU.bindLogout();

  var upcomingList = document.getElementById("upcomingList");
  var historyList = document.getElementById("historyList");
  var upcomingCount = document.getElementById("upcomingCount");
  var confirmedCount = document.getElementById("confirmedCount");
  var pendingCount = document.getElementById("pendingCount");
  var totalCount = document.getElementById("totalCount");

  var soon = document.querySelectorAll("[data-soon]");
  for (var s = 0; s < soon.length; s++) {
    soon[s].addEventListener("click", function (e) {
      e.preventDefault();
      NU.toast("That page is part of the next batch.");
    });
  }

  function render() {
    var all = NU.reservationsFor(session.studentNo).sort(function (a, b) {
      return (a.date + a.slot).localeCompare(b.date + b.slot);
    });

    var today = NU.todayISO();
    var upcoming = all.filter(function (r) {
      return r.date >= today && r.status !== "Cancelled" && r.status !== "Completed";
    });

    var history = all.filter(function (r) {
      return r.date < today || r.status === "Cancelled" || r.status === "Completed";
    }).sort(function (a, b) {
      return (b.date + b.slot).localeCompare(a.date + a.slot);
    });

    upcomingCount.textContent = String(upcoming.length);
    confirmedCount.textContent = String(upcoming.filter(function (r) {
      return r.status === "Confirmed";
    }).length);
    pendingCount.textContent = String(upcoming.filter(function (r) {
      return r.status === "Pending";
    }).length);
    totalCount.textContent = String(all.length);

    upcomingList.innerHTML = upcoming.length ? upcoming.map(renderItem).join("") :
      '<div class="res-empty">No upcoming reservations yet.<br>Book a study area from the dashboard.</div>';

    historyList.innerHTML = history.length ? history.map(renderHistoryItem).join("") :
      '<div class="res-empty">No reservation history yet.</div>';
  }

  function renderItem(r) {
    var area = NU.getArea(r.areaId);
    var badgeClass = r.status === "Confirmed" ? "badge badge-ok" : "badge badge-warn";
    return '<div class="reservation-item">'
      + '<div class="res-item-top">'
      + '<span class="res-item-title">' + NU.escapeHtml(area ? area.name : r.areaId) + '</span>'
      + '<span class="' + badgeClass + '">' + r.status + '</span>'
      + '</div>'
      + '<div class="res-item-meta">'
      + '<div><b>Date:</b> ' + NU.fmtDateShort(r.date) + '</div>'
      + '<div><b>Time:</b> ' + NU.fmtRange(r.slot) + '</div>'
      + '<div><b>Capacity:</b> ' + (area ? area.capacity : "-") + '</div>'
      + '<div><b>Purpose:</b> ' + NU.escapeHtml(r.purpose || "Study") + '</div>'
      + '</div>'
      + '<div class="res-item-bottom">'
      + '<span class="res-item-purpose">Reservation ID: ' + NU.escapeHtml(r.id) + '</span>'
      + (r.status === "Pending" || r.status === "Confirmed"
        ? '<button type="button" class="btn btn-ghost btn-sm cancel-btn" data-cancel="' + r.id + '">Cancel</button>'
        : '')
      + '</div>'
      + '</div>';
  }

  function renderHistoryItem(r) {
    var area = NU.getArea(r.areaId);
    var badgeClass = r.status === "Cancelled" ? "badge badge-danger"
      : r.status === "Completed" ? "badge badge-mute"
      : "badge badge-info";
    return '<div class="reservation-item">'
      + '<div class="res-item-top">'
      + '<span class="res-item-title">' + NU.escapeHtml(area ? area.name : r.areaId) + '</span>'
      + '<span class="' + badgeClass + '">' + r.status + '</span>'
      + '</div>'
      + '<div class="res-item-meta">'
      + '<div><b>Date:</b> ' + NU.fmtDateShort(r.date) + '</div>'
      + '<div><b>Time:</b> ' + NU.fmtRange(r.slot) + '</div>'
      + '<div><b>Purpose:</b> ' + NU.escapeHtml(r.purpose || "Study") + '</div>'
      + '<div><b>ID:</b> ' + NU.escapeHtml(r.id) + '</div>'
      + '</div>'
      + '</div>';
  }

  document.addEventListener("click", function (e) {
    var cancelBtn = e.target.closest("[data-cancel]");
    if (!cancelBtn) return;

    var id = cancelBtn.getAttribute("data-cancel");
    NU.setStatus(id, "Cancelled");
    NU.toast("Reservation cancelled.", "good");
    render();
  });

  render();
})();
