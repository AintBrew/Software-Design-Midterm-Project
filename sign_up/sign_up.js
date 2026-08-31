/* ============================================================
   sign_up.js - student registration for the NU Fairview LRC
   Study Area Online Booking System.

   Front end only. New accounts are kept in localStorage through
   shared/nu-data.js so the login page can find them afterwards.
   ============================================================ */

(function () {
  "use strict";

  var form      = document.getElementById("signupForm");
  var card      = document.querySelector(".auth-card");
  var submitBtn = document.getElementById("submitBtn");
  var peekBtn   = document.getElementById("peekBtn");
  var passInput = document.getElementById("password");

  var FIELDS = ["fullName", "studentNo", "program", "email", "username",
                "password", "confirm", "agree"];

  /* ---------- error helpers ---------- */

  function showError(id, message) {
    var input = document.getElementById(id);
    var slot  = document.getElementById(id + "Err");
    if (input && input.type !== "checkbox") input.classList.add("bad");
    if (slot) {
      slot.textContent = message;
      slot.classList.add("show");
    }
  }

  function clearErrors() {
    for (var i = 0; i < FIELDS.length; i++) {
      var input = document.getElementById(FIELDS[i]);
      var slot  = document.getElementById(FIELDS[i] + "Err");
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

  // clear a field's error as soon as it is edited
  for (var f = 0; f < FIELDS.length; f++) {
    (function (id) {
      var input = document.getElementById(id);
      if (!input) return;
      var event = (input.tagName === "SELECT" || input.type === "checkbox") ? "change" : "input";
      input.addEventListener(event, function () {
        input.classList.remove("bad");
        var slot = document.getElementById(id + "Err");
        slot.textContent = "";
        slot.classList.remove("show");
      });
    })(FIELDS[f]);
  }

  /* ---------- show / hide password ---------- */

  peekBtn.addEventListener("click", function () {
    var hidden = passInput.type === "password";
    passInput.type = hidden ? "text" : "password";
    peekBtn.textContent = hidden ? "Hide" : "Show";
    peekBtn.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
    peekBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
    passInput.focus();
  });

  /* ---------- password strength meter ---------- */

  var meter      = document.getElementById("meter");
  var meterLabel = document.getElementById("meterLabel");

  function scorePassword(value) {
    if (!value) return 0;
    var score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    if (score > 3) score = 3;
    return score;
  }

  passInput.addEventListener("input", function () {
    var value = passInput.value;
    var score = scorePassword(value);

    meter.className = "meter" + (score ? " s" + score : "");
    meterLabel.className = "meter-label" + (score ? " s" + score : "");

    if (!value) {
      meterLabel.textContent = "Use 8 or more characters.";
    } else if (value.length < 8) {
      meterLabel.textContent = "Too short - use at least 8 characters.";
    } else if (score === 1) {
      meterLabel.textContent = "Weak - add numbers or capital letters.";
    } else if (score === 2) {
      meterLabel.textContent = "Fair - a symbol would make it stronger.";
    } else {
      meterLabel.textContent = "Strong password.";
    }
  });

  /* ---------- policy dialog ---------- */

  var policyVeil = document.getElementById("policyVeil");

  document.getElementById("policyLink").addEventListener("click", function (e) {
    e.preventDefault();
    policyVeil.hidden = false;
    document.getElementById("policyClose").focus();
  });

  document.getElementById("policyClose").addEventListener("click", function () {
    policyVeil.hidden = true;
  });

  policyVeil.addEventListener("click", function (e) {
    if (e.target === policyVeil) policyVeil.hidden = true;
  });

  /* ---------- validation ---------- */

  function validate() {
    var v = {
      fullName:  document.getElementById("fullName").value.trim(),
      studentNo: document.getElementById("studentNo").value.trim(),
      program:   document.getElementById("program").value,
      email:     document.getElementById("email").value.trim(),
      username:  document.getElementById("username").value.trim(),
      password:  document.getElementById("password").value,
      confirm:   document.getElementById("confirm").value,
      agree:     document.getElementById("agree").checked
    };

    var firstBad = null;

    function fail(id, message) {
      showError(id, message);
      if (!firstBad) firstBad = id;
    }

    if (v.fullName.length < 3) {
      fail("fullName", "Enter your full name as it appears on your student record.");
    }

    if (!v.studentNo) {
      fail("studentNo", "Enter your student number.");
    } else if (!/^\d{2}-\d{5}$/.test(v.studentNo)) {
      fail("studentNo", "Use the format 21-04512 - two digits, a dash, then five digits.");
    }

    if (!v.program) {
      fail("program", "Select your program.");
    }

    if (!v.email) {
      fail("email", "Enter your NU Fairview e-mail address.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
      fail("email", "That does not look like a valid e-mail address.");
    } else if (!/nu-fairview\.edu\.ph$/i.test(v.email)) {
      fail("email", "Use your NU Fairview address, ending in nu-fairview.edu.ph.");
    }

    if (!v.username) {
      fail("username", "Choose a username.");
    } else if (v.username.length < 4) {
      fail("username", "Usernames need at least 4 characters.");
    } else if (!/^[A-Za-z0-9._]+$/.test(v.username)) {
      fail("username", "Use letters, numbers, dots, and underscores only.");
    } else if (NU.findAccount(v.username)) {
      fail("username", "That username is already taken. Try another one.");
    }

    if (!v.password) {
      fail("password", "Choose a password.");
    } else if (v.password.length < 8) {
      fail("password", "Passwords must be at least 8 characters long.");
    }

    if (!v.confirm) {
      fail("confirm", "Re-enter your password.");
    } else if (v.confirm !== v.password) {
      fail("confirm", "The two passwords do not match.");
    }

    if (!v.agree) {
      fail("agree", "You need to agree to the LRC reservation policies to continue.");
    }

    return { values: v, firstBad: firstBad };
  }

  /* ---------- submit ---------- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearErrors();

    var check = validate();

    if (check.firstBad) {
      var formSlot = document.getElementById("formErr");
      formSlot.textContent = "Some details still need fixing. Check the highlighted fields below.";
      formSlot.classList.add("show");

      card.classList.remove("shake");
      void card.offsetWidth;
      card.classList.add("shake");

      var target = document.getElementById(check.firstBad);
      if (target) target.focus();
      return;
    }

    submitBtn.classList.add("busy");
    submitBtn.disabled = true;

    setTimeout(function () {
      var v = check.values;

      NU.addAccount({
        username:  v.username,
        password:  v.password,
        role:      "student",
        name:      v.fullName,
        studentNo: v.studentNo,
        program:   v.program,
        email:     v.email
      });

      NU.toast("Account created for " + v.fullName + ".", "good");

      // hand off to the login page with the new username filled in
      window.location.href = "../login/login.html?registered=1&u="
                             + encodeURIComponent(v.username);
    }, 650);
  });

  document.getElementById("fullName").focus();
})();
