(function () {
  const Auth = {
    setError(message) {
      const box = document.getElementById('login-error');
      box.textContent = message;
      box.style.display = message ? 'block' : 'none';
    },

    setLoading(loading) {
      const button = document.getElementById('login-btn');
      button.disabled = loading;
      button.textContent = loading ? 'Ingresando…' : 'Ingresar';
    },

    async login() {
      const login = document.getElementById('login-user').value.trim();
      const pass = document.getElementById('login-pass').value;
      this.setError('');
      if (!login || !pass) {
        this.setError('Ingresa usuario y contraseña.');
        return;
      }

      this.setLoading(true);
      try {
        const response = await App.post('/api/login', { login, pass });
        App.clearCache();
        App.saveSession(response.token, response.user);
        App.showScreen('app');
        App.openMain('home');
      } catch (error) {
        this.setError(error.message);
      } finally {
        this.setLoading(false);
      }
    },

    async logout() {
      try { await App.post('/api/logout'); } catch (_) {}
      App.resetSession();
      document.getElementById('login-pass').value = '';
      this.setError('');
      App.showScreen('login');
    },

    async restoreSession() {
      if (!App.state.token || !App.state.user) return;
      try {
        await App.fetchWorks(true);
        App.saveSession(App.state.token, App.state.user);
        App.showScreen('app');
        App.openMain('home');
      } catch (_) {
        App.resetSession();
      }
    },

    init() {
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && document.getElementById('screen-login').classList.contains('active')) {
          this.login();
        }
      });
      this.restoreSession();
    },
  };

  window.Auth = Auth;
  Auth.init();
})();
