// Login and registration. Email + password only — no confirmation mail, no
// magic links, no reset flow. Email confirmation must be OFF in the Supabase
// project settings or registration will not return a session.

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
    message.textContent =
      'Account created, but no session was returned. Turn off email confirmation in Supabase.';
    return;
  }

  window.location.replace('index.html');
});

// Already signed in? Skip the form.
currentUser().then((user) => {
  if (user) window.location.replace('index.html');
});

applyMode();
