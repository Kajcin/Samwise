export const environment = {
  production: false,
  // Show the email/password login form (create the user with `npm run dev:user`).
  devEmailLogin: true,
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  // Public OAuth client id (not a secret; the client secret stays in the Edge Functions).
  googleClientId: '275724813342-ma67q01darsev94n1bcsq21f6b1rnkm8.apps.googleusercontent.com',
};
