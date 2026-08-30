/* ============================================================
   login.js - sign in behaviour for the NU Fairview LRC
   Study Area Online Booking System.

   Front end only. Accounts live in shared/nu-data.js.
   ============================================================ */

(function () {
  "use strict";

  var form      = document.getElementById("loginForm");
  var card      = document.querySelector(".auth-card");
  var userInput = document.getElementById("username");
  var passInput = document.getElementById("password");
  var submitBtn = document.getElementById("submitBtn");
  var peekBtn   = document.getElementById("peekBtn");

  var veil         = document.getElementById("successVeil");
  var successTitle = document.getElementById("successTitle");
  var successBody  = document.getElementById("successBody");
  var successNote  = document.getElementById("successNote");

  /* ---------- error helpers ---------- */

  function showError(inputId, message) {
    var input = document.getElementById(inputId);
    var slot  = document.getElementById(inputId + "Err");
    if (input) input.classList.add("bad");
    if (slot) {
      slot.textContent = message;
      slot.classList.add("show");
    }
  }

  function showFormError(message) {
    var slot = document.getElementById("formErr");
    slot.textContent = message;
    slot.classList.add("show");
    card.classList.remove("shake");
    void card.offsetWidth;          // restart the animation
    card.classList.add("shake");
  }

  function clearErrors() {
    var fields = ["username", "password"];
    for (var i = 0; i < fields.length; i++) {
      var input = document.getElementById(fields[i]);
      var slot  = document.getElementById(fields[i] + "Err");
      if (input) input.classList.remove("bad");
      if (slot) {
        slot.textContent = "";
        slot.classList.remove("show");
      }
    }
    var formSlot = document.getElementById("formErr");
    formSlot.textContent = "";
    formSlot.classList.remove("show");
  }

  // clear a field's error as soon as the student edits it
  [userInput, passInput].forEach(function (input) {
    input.addEventListener("input", function () {
      input.classList.remove("bad");
      var slot = document.getElementById(input.id + "Err");
      slot.textContent = "";
      slot.classList.remove("show");
    });
  });

  /* ---------- show / hide password ---------- */

  peekBtn.addEventListener("click", function () {
    var hidden = passInput.type === "password";
    passInput.type = hidden ? "text" : "password";
    peekBtn.textContent = hidden ? "Hide" : "Show";
    peekBtn.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
    peekBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
    passInput.focus();
  });

  /* ---------- forgot password (no email service yet) ---------- */

  document.getElementById("forgotLink").addEventListener("click", function (e) {
    e.preventDefault();
    NU.toast("Password resets are handled at the LRC counter for now.");
  });

  /* ---------- submit ---------- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearErrors();

    var username = userInput.value.trim();
    var password = passInput.value;
    var bad = false;

    if (!username) {
      showError("username", "Enter your username to continue.");
      bad = true;
    }
    if (!password) {
      showError("password", "Enter your password to continue.");
      bad = true;
    }
    if (bad) {
      card.classList.remove("shake");
      void card.offsetWidth;
      card.classList.add("shake");
      return;
    }

    // brief busy state so the button reads like a real sign in
    submitBtn.classList.add("busy");
    submitBtn.disabled = true;

    setTimeout(function () {
      var result = NU.signIn(username, password);

      submitBtn.classList.remove("busy");
      submitBtn.disabled = false;

      if (!result.ok) {
        showError(result.field, result.message);
        showFormError("Sign in failed. Please check your username and password.");
        document.getElementById(result.field).focus();
        return;
      }

      openSuccess(result.user);
    }, 550);
  });

  /* ---------- success panel ---------- */

  function openSuccess(user) {
    var first = user.name.split(" ")[0];
    var where = user.role === "student"
      ? "your student dashboard"
      : "the LRC staff dashboard";

    successTitle.textContent = "Welcome back, " + first;
    successBody.textContent  = "Signed in as " + user.name + " - opening " + where + "...";
    successNote.textContent  = "";
    successNote.hidden = true;

    veil.hidden = false;
    NU.toast("Signed in as " + user.name, "good");

    // let the tick finish drawing, then go to the dashboard
    setTimeout(function () {
      window.location.href = NU.HOME[user.role];
    }, 900);
  }

  /* ---------- on load ---------- */

  // A student sent here from the sign up page arrives with their
  // new username already in the address bar.
  var params = new URLSearchParams(window.location.search);
  if (params.get("registered") === "1") {
    var newUser = params.get("u") || "";
    userInput.value = newUser;
    NU.toast("Account created. Sign in to continue.", "good");
    passInput.focus();
  } else {
    userInput.focus();
  }
})();
