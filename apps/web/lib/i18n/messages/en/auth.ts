import type de from '../de/auth';

const auth: typeof de = {
  loginTitle: 'Sign in',
  signupTitle: 'Create account',
  signupPageTitle: 'Sign up',
  tagline: 'How visible is your brand in ChatGPT, Gemini, Claude & Google?',
  name: 'Name',
  email: 'Email',
  password: 'Password',
  passwordHint: 'At least 8 characters.',
  busy: 'One moment …',
  noAccount: 'No account yet?',
  signupLink: 'Sign up',
  haveAccount: 'Already have an account?',
  loginLink: 'Sign in',
  errors: {
    invalidCredentials: 'Incorrect email or password.',
    userExists: 'An account with this email already exists.',
    passwordTooShort: 'Your password needs at least 8 characters.',
    invalidEmail: 'Please enter a valid email address.',
    generic: 'Something went wrong. Please try again.',
  },
  closed: {
    title: 'Sign-up is closed',
    text: 'New accounts can’t be created on this instance. Please contact the person who runs Askmetry here.',
    toLogin: 'Go to sign in',
  },
};
export default auth;
