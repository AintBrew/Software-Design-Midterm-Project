/* ============================================================
   my_reservations.js - the student's own upcoming bookings and
   history, live from Firestore. Cancelling is a transaction that
   re-checks the one-hour rule (also enforced by the rules).
   ============================================================ */

import {
  requireRole, signOutUser, describeError, LOCATION, ACTIVE_STATUSES,
  watchMyReservations, cancelMyReservation, canStudentCancel, millis
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
  document.getElementById("userId").textContent = "ID: " + session.studentNo;
  document.querySelectorAll("[data-logout]").forEach(function (link) {
    link.addEventListener("click", async function (e) {
      e.preventDefault();
      await signOutUser();
      window.location.href = "../login/login.html";
    });
  });
  NU.bindSoon();

  var upcomingList = document.getElementById("upcomingList");
  var historyList = document.getElementById("historyList");
  var mine = null;

  function isUpcoming(r, now) {
    return ACTIVE_STATUSES.indexOf(r.status) !== -1 && millis(r.end) > now;
  }

  function render() {
    if (!mine) return;
    var now = Date.now();

    var upcoming = mine.filter(function (r) { return isUpcoming(r, now); })
      .sort(function (a, b) { return millis(a.start) - millis(b.start); });

    var history = mine.filter(function (r) { return !isUpcoming(r, now); })
      .sort(function (a, b) { return millis(b.start) - millis(a.start); });

    document.getElementById("upcomingCount").textContent = String(upcoming.length);
    document.getElementById("confirmedCount").textContent = String(upcoming.filter(function (r) {
      return r.status === "confirmed";
    }).length);
    document.getElementById("pendingCount").textContent = String(upcoming.filter(function (r) {
      return r.status === "pending";
    }).length);
    document.getElementById("totalCount").textContent = String(mine.length);

    upcomingList.innerHTML = upcoming.length ? upcoming.map(function (r) {
      return renderItem(r, now);
    }).join("") :
      '<div class="res-empty">No upcoming reservations yet.<br>Book a study area from the dashboard.</div>';

    historyList.innerHTML = history.length ? history.map(renderHistoryItem).join("") :
      '<div class="res-empty">No reservation history yet.</div>';
  }

  function attendeesBlock(r) {
    if (r.facilityType !== "discussion") return "";
    var list = r.attendees || [];
    if (!list.length) return '<p class="res-attendees">Attendees: just you</p>';
    return '<details class="res-attendees"><summary>Attendees (' + list.length + ')</summary><ul>'
      + list.map(function (a) {
          return '<li>' + NU.escapeHtml(a.name) + ' (' + NU.escapeHtml(a.studentNo) + ')</li>';
        }).join("")
      + '</ul></details>';
  }

  function meta(r) {
    return '<div class="res-item-meta">'
      + '<div><b>Study area:</b> ' + NU.escapeHtml(r.facilityName) + '</div>'
      + '<div><b>Date:</b> ' + NU.fmtDateShort(r.date) + '</div>'
      + '<div><b>Time:</b> ' + NU.fmtRange(r.startHour, r.endHour) + '</div>'
      + '<div><b>Location:</b> ' + NU.escapeHtml(r.location || LOCATION) + '</div>'
      + '<div><b>Capacity:</b> ' + NU.capacityText(r.capacity) + '</div>'
      + '<div><b>Group size:</b> ' + (r.groupSize || 1) + '</div>'
      + '<div><b>Purpose:</b> ' + NU.escapeHtml(r.purpose || "Study") + '</div>'
      + '</div>';
  }

  function renderItem(r, now) {
    var action;
    if (canStudentCancel(r, now)) {
      action = '<button type="button" class="btn btn-ghost btn-sm cancel-btn" data-cancel="'
             + NU.escapeHtml(r.id) + '">Cancel</button>';
    } else {
      action = '<span class="res-item-note">Cancellation closed (needs 1 hour notice)</span>';
    }
    return '<div class="reservation-item">'
      + '<div class="res-item-top">'
      + '<span class="res-item-title">' + NU.escapeHtml(r.resourceLabel) + '</span>'
      + NU.statusBadge(r.status)
      + '</div>'
      + meta(r)
      + attendeesBlock(r)
      + '<div class="res-item-bottom">'
      + '<span class="res-item-purpose">Reservation ID: ' + NU.escapeHtml(r.id) + '</span>'
      + action
      + '</div>'
      + '</div>';
  }

  function renderHistoryItem(r) {
    var note = r.staffNote ? '<p class="res-item-note">Staff note: ' + NU.escapeHtml(r.staffNote) + '</p>' : "";
    return '<div class="reservation-item">'
      + '<div class="res-item-top">'
      + '<span class="res-item-title">' + NU.escapeHtml(r.resourceLabel) + '</span>'
      + NU.statusBadge(r.status)
      + '</div>'
      + meta(r)
      + attendeesBlock(r)
      + note
      + '<span class="res-item-note">ID: ' + NU.escapeHtml(r.id) + '</span>'
      + '</div>';
  }

  upcomingList.addEventListener("click", async function (e) {
    var cancelBtn = e.target.closest("[data-cancel]");
    if (!cancelBtn) return;

    var id = cancelBtn.getAttribute("data-cancel");
    var r = mine.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (!window.confirm("Cancel your reservation for " + r.resourceLabel + " on "
        + NU.fmtDateShort(r.date) + ", " + NU.fmtRange(r.startHour, r.endHour) + "?")) return;

    cancelBtn.disabled = true;
    cancelBtn.textContent = "Cancelling...";
    try {
      await cancelMyReservation(id, session.uid);
      NU.toast("Reservation cancelled. The time slot is open again.", "good");
    } catch (err) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = "Cancel";
      NU.toast(describeError(err), "bad");
      render();
    }
  });

  watchMyReservations(session.uid, function (list) {
    mine = list;
    loadErr.hidden = true;
    render();
  }, function (err) {
    showLoadError(err);
    upcomingList.innerHTML = '<div class="res-empty">Your reservations could not be loaded.</div>';
    historyList.innerHTML = "";
  });

  // move bookings into history and close cancellation windows on time
  setInterval(render, 60 * 1000);
}
