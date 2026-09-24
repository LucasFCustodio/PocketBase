// Login and registration. Email + password only — no magic links, no reset
// flow. Email confirmation is ON in Supabase, so registering returns no session
// until the user clicks the link in the confirmation email.

import { supabase, currentUser } from './supabase.js';

const form = document.querySelector('#auth-form');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const message = document.querySelector('#auth-message');
const submit = document.querySelector('#auth-submit');
const toggle = document.querySelector('#auth-toggle');

let mode = 'login';

function applyMode() {
  const registering = mode === 'register';
  submit.textContent = registering ? 'Create account' : 'Log in';
  toggle.textContent = registering
    ? 'Already have an account? Log in'
    : 'No account yet? Create one';
  message.textContent = '';
}

toggle.addEventListener('click', () => {
  mode = mode === 'login' ? 'register' : 'login';
  applyMode();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (password.length < 6) {
    message.textContent = 'Password must be at least 6 characters.';
    return;
  }

  submit.disabled = true;
  message.textContent = mode === 'register' ? 'Creating account…' : 'Logging in…';

  const { error } = mode === 'register'
    ? await supabase.auth.signUp({ email, password })
    : await supabase.auth.signInWithPassword({ email, password });

  submit.disabled = false;

  if (error) {
    message.textContent = error.message;
    return;
  }

  if (!(await currentUser())) {
    mode = 'login';
    applyMode();
    message.textContent =
      'Account created. Check your email for a confirmation link, then log in here.';
    return;
  }

  window.location.replace('index.html');
});

// Already signed in? Skip the form.
currentUser().then((user) => {
  if (user) window.location.replace('index.html');
});

applyMode();
