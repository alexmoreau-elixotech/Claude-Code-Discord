/* =========================================================
   Claude Code Assistant — Setup Wizard & Dashboard
   Vanilla JS, no frameworks
   ========================================================= */

(function () {
  'use strict';

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------

  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return document.querySelectorAll(selector);
  }

  function show(el) {
    if (typeof el === 'string') el = $(el);
    if (el) el.classList.remove('hidden');
  }

  function hide(el) {
    if (typeof el === 'string') el = $(el);
    if (el) el.classList.add('hidden');
  }

  async function api(method, path, body) {
    const opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(function () { return { error: 'Request failed' }; });
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  }

  function redactToken(token) {
    if (!token || token.length < 8) return '****';
    return '****' + token.slice(-4);
  }

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------

  var state = {
    currentStep: 1,
    totalSteps: 5,

    // Step 2
    token: '',
    tokenValid: false,
    botName: '',
    botId: '',
    appId: '',
    inviteUrl: '',

    // Step 3
    guilds: [],
    selectedGuildId: '',
    selectedGuildName: '',
    roles: [],
    selectedRoleId: '',
    userId: '',

    // Step 4
    claudeHome: '',
    githubToken: '',
    gitName: '',
    gitEmail: '',
    claudeMd: '',

    // Launch
    launching: false,
  };

  // -------------------------------------------------------
  // Initialization
  // -------------------------------------------------------

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      var data = await api('GET', '/api/setup/status');
      hide('#loading-screen');

      if (data.setupComplete) {
        showDashboard();
      } else {
        showWizard();
      }
    } catch (err) {
      hide('#loading-screen');
      showWizard();
    }
  }

  function showWizard() {
    hide('#dashboard');
    show('#wizard');
    goToStep(1);
  }

  function showDashboard() {
    hide('#wizard');
    show('#dashboard');
    Dashboard.load();
  }

  // -------------------------------------------------------
  // Wizard — Step Navigation
  // -------------------------------------------------------

  function goToStep(step) {
    state.currentStep = step;
    updateStepIndicator();
    updateStepPanels();

    if (step === 3) {
      Wizard.loadGuilds();
    }
    if (step === 5) {
      Wizard.buildReview();
    }
  }

  function updateStepIndicator() {
    var items = $$('.step-item');
    var lines = $$('.step-line');

    items.forEach(function (item) {
      var s = parseInt(item.getAttribute('data-step'));
      item.classList.remove('active', 'completed');
      if (s === state.currentStep) {
        item.classList.add('active');
      } else if (s < state.currentStep) {
        item.classList.add('completed');
      }
    });

    lines.forEach(function (line, i) {
      line.classList.remove('completed');
      if (i + 1 < state.currentStep) {
        line.classList.add('completed');
      }
    });
  }

  function updateStepPanels() {
    $$('.step-panel').forEach(function (panel) {
      var p = parseInt(panel.getAttribute('data-panel'));
      panel.classList.remove('active');
      if (p === state.currentStep) {
        panel.classList.add('active');
      }
    });
  }

  // -------------------------------------------------------
  // Wizard Object (exposed globally)
  // -------------------------------------------------------

  window.Wizard = {
    nextStep: function () {
      if (state.currentStep < state.totalSteps) {
        goToStep(state.currentStep + 1);
      }
    },

    prevStep: function () {
      if (state.currentStep > 1) {
        goToStep(state.currentStep - 1);
      }
    },

    // --- Step 2: Token Validation ---

    validateToken: async function () {
      var tokenInput = $('#bot-token');
      var token = tokenInput.value.trim();
      var statusEl = $('#token-status');
      var nextBtn = $('#step2-next');
      var validateBtn = $('#validate-token-btn');

      if (!token) {
        show(statusEl);
        statusEl.className = 'status-message error';
        statusEl.textContent = 'Please enter a token.';
        return;
      }

      validateBtn.disabled = true;
      validateBtn.textContent = 'Validating...';
      hide(statusEl);

      try {
        var data = await api('POST', '/api/setup/validate-token', { token: token });

        if (data.valid) {
          state.token = token;
          state.tokenValid = true;
          state.botName = data.botName;
          state.botId = data.botId;
          state.appId = data.appId;

          show(statusEl);
          statusEl.className = 'status-message success';
          statusEl.textContent = 'Bot validated: ' + data.botName;

          nextBtn.disabled = false;

          // Fetch invite URL
          try {
            var invite = await api('POST', '/api/setup/invite-url', { appId: data.appId });
            state.inviteUrl = invite.url;
            $('#invite-link').href = invite.url;
            if ($('#invite-link-alt')) {
              $('#invite-link-alt').href = invite.url;
            }
            show('#invite-section');
          } catch (e) {
            // Non-critical, invite URL is a convenience
          }
        } else {
          show(statusEl);
          statusEl.className = 'status-message error';
          statusEl.textContent = data.error || 'Invalid token.';
          nextBtn.disabled = true;
          state.tokenValid = false;
        }
      } catch (err) {
        show(statusEl);
        statusEl.className = 'status-message error';
        statusEl.textContent = err.message || 'Failed to validate token.';
        nextBtn.disabled = true;
        state.tokenValid = false;
      }

      validateBtn.disabled = false;
      validateBtn.textContent = 'Validate';
    },

    // --- Step 3: Guilds ---

    loadGuilds: async function () {
      if (!state.tokenValid) return;

      show('#guilds-loading');
      hide('#guilds-list');
      hide('#no-guilds');
      hide('#permissions-section');

      try {
        var guilds = await api('POST', '/api/setup/guilds', { token: state.token });
        state.guilds = guilds;

        hide('#guilds-loading');

        if (guilds.length === 0) {
          show('#no-guilds');
          if (state.inviteUrl) {
            $('#invite-link-alt').href = state.inviteUrl;
          }
        } else {
          var select = $('#guild-select');
          // Clear existing options (keep the placeholder)
          select.innerHTML = '<option value="">Select a server...</option>';
          guilds.forEach(function (g) {
            var opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            select.appendChild(opt);
          });

          // If previously selected, restore
          if (state.selectedGuildId) {
            select.value = state.selectedGuildId;
          }

          show('#guilds-list');
        }
      } catch (err) {
        hide('#guilds-loading');
        show('#no-guilds');
      }
    },

    refreshGuilds: function () {
      Wizard.loadGuilds();
    },

    onGuildSelected: async function () {
      var select = $('#guild-select');
      var guildId = select.value;
      var nextBtn = $('#step3-next');

      if (!guildId) {
        hide('#permissions-section');
        nextBtn.disabled = true;
        return;
      }

      state.selectedGuildId = guildId;
      state.selectedGuildName = select.options[select.selectedIndex].text;

      show('#permissions-section');
      Wizard.updateStep3Next();

      // Fetch roles
      try {
        var roles = await api('POST', '/api/setup/guild-roles', {
          token: state.token,
          guildId: guildId,
        });
        state.roles = roles;

        var roleSelect = $('#role-select');
        roleSelect.innerHTML = '<option value="">Select a role...</option>';
        roles.forEach(function (r) {
          var opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = r.name;
          roleSelect.appendChild(opt);
        });
      } catch (err) {
        // Roles are optional-ish, don't block
        state.roles = [];
      }
    },

    onPermModeChange: function () {
      var mode = document.querySelector('input[name="perm-mode"]:checked').value;
      if (mode === 'role') {
        show('#role-picker');
        hide('#user-id-section');
      } else {
        hide('#role-picker');
        show('#user-id-section');
      }
      Wizard.updateStep3Next();
    },

    updateStep3Next: function () {
      var nextBtn = $('#step3-next');
      if (!state.selectedGuildId) {
        nextBtn.disabled = true;
        return;
      }

      var mode = document.querySelector('input[name="perm-mode"]:checked').value;
      if (mode === 'user') {
        var userId = $('#user-id-input').value.trim();
        nextBtn.disabled = !userId;
      } else {
        var roleId = $('#role-select').value;
        nextBtn.disabled = !roleId;
      }
    },

    // --- Step 4: Collapsible ---

    toggleCollapsible: function (btn) {
      var section = btn.parentElement;
      section.classList.toggle('open');
    },

    // --- Step 5: Review ---

    buildReview: function () {
      // Collect step 4 values
      state.claudeHome = $('#claude-home').value.trim();
      state.githubToken = $('#github-token').value.trim();
      state.gitName = $('#git-name').value.trim();
      state.gitEmail = $('#git-email').value.trim();
      state.claudeMd = $('#claude-md').value.trim();
      state.userId = $('#user-id-input').value.trim();
      state.selectedRoleId = $('#role-select').value;

      var container = $('#review-summary');
      container.innerHTML = '';

      var rows = [
        { label: 'Bot', value: state.botName || 'Unknown' },
        { label: 'Token', value: redactToken(state.token) },
        { label: 'Server', value: state.selectedGuildName || 'Not selected' },
      ];

      var mode = document.querySelector('input[name="perm-mode"]:checked').value;
      if (mode === 'user') {
        rows.push({ label: 'User ID', value: state.userId || 'Not set' });
      } else {
        var roleName = '';
        var selectedRole = state.roles.find(function (r) { return r.id === state.selectedRoleId; });
        roleName = selectedRole ? selectedRole.name : state.selectedRoleId;
        rows.push({ label: 'Role', value: roleName || 'Not set' });
      }

      rows.push({ label: 'Claude Home', value: state.claudeHome || 'Not set' });
      rows.push({ label: 'GitHub Token', value: state.githubToken ? redactToken(state.githubToken) : 'Not set', muted: !state.githubToken });
      rows.push({ label: 'Git Name', value: state.gitName || 'Not set', muted: !state.gitName });
      rows.push({ label: 'Git Email', value: state.gitEmail || 'Not set', muted: !state.gitEmail });
      rows.push({ label: 'CLAUDE.md', value: state.claudeMd ? 'Configured (' + state.claudeMd.length + ' chars)' : 'Not set', muted: !state.claudeMd });

      rows.forEach(function (row) {
        var div = document.createElement('div');
        div.className = 'review-row';
        div.innerHTML =
          '<span class="review-label">' + escapeHtml(row.label) + '</span>' +
          '<span class="review-value' + (row.muted ? ' muted' : '') + '">' + escapeHtml(row.value) + '</span>';
        container.appendChild(div);
      });
    },

    // --- Step 5: Launch ---

    launch: async function () {
      if (state.launching) return;
      state.launching = true;

      var launchBtn = $('#launch-btn');
      var launchActions = $('#launch-actions');
      var launchStatus = $('#launch-status');
      var launchMessage = $('#launch-message');
      var launchSuccess = $('#launch-success');
      var launchError = $('#launch-error');
      var launchErrorMsg = $('#launch-error-message');

      launchBtn.disabled = true;
      hide(launchError);
      hide(launchSuccess);
      show(launchStatus);
      launchMessage.textContent = 'Building Docker image...';

      try {
        // Step 1: Build image
        await api('POST', '/api/setup/build-image');

        // Step 2: Save config
        launchMessage.textContent = 'Saving configuration...';

        var mode = document.querySelector('input[name="perm-mode"]:checked').value;

        if (!state.claudeHome) {
          throw new Error('Claude home directory is required. Go back to Step 4.');
        }

        var config = {
          discord: {
            token: state.token,
            guildId: state.selectedGuildId,
          },
          claudeHome: state.claudeHome,
          setupComplete: true,
        };

        if (mode === 'user') {
          config.discord.userId = state.userId;
        } else {
          config.discord.roleId = state.selectedRoleId;
        }

        if (state.githubToken) {
          config.github = { token: state.githubToken };
        }
        if (state.gitName || state.gitEmail) {
          config.git = {};
          if (state.gitName) config.git.userName = state.gitName;
          if (state.gitEmail) config.git.userEmail = state.gitEmail;
        }
        if (state.claudeMd) {
          config.claudeMd = state.claudeMd;
        }

        await api('POST', '/api/setup/save', config);

        // Step 3: Success!
        hide(launchStatus);
        hide(launchActions);
        show(launchSuccess);

        var discordLink = $('#discord-server-link');
        discordLink.href = 'https://discord.com/channels/' + state.selectedGuildId;

      } catch (err) {
        hide(launchStatus);
        show(launchError);
        launchErrorMsg.textContent = err.message || 'Something went wrong during setup.';
        launchBtn.disabled = false;
        state.launching = false;
      }
    },
  };

  // Bind real-time validation for step 3
  document.addEventListener('DOMContentLoaded', function () {
    var userIdInput = $('#user-id-input');
    if (userIdInput) {
      userIdInput.addEventListener('input', function () {
        Wizard.updateStep3Next();
      });
    }
    var roleSelect = $('#role-select');
    if (roleSelect) {
      roleSelect.addEventListener('change', function () {
        Wizard.updateStep3Next();
      });
    }
  });

  // Since DOMContentLoaded may have already fired by the time the IIFE runs
  // with deferred scripts, also bind immediately.
  (function bindStep3Listeners() {
    var userIdInput = $('#user-id-input');
    if (userIdInput) {
      userIdInput.addEventListener('input', function () {
        Wizard.updateStep3Next();
      });
    }
    var roleSelect = $('#role-select');
    if (roleSelect) {
      roleSelect.addEventListener('change', function () {
        Wizard.updateStep3Next();
      });
    }
  })();

  // -------------------------------------------------------
  // Dashboard Object (exposed globally)
  // -------------------------------------------------------

  window.Dashboard = {
    load: async function () {
      await Promise.all([
        Dashboard.loadProjects(),
        Dashboard.loadConfig(),
      ]);
    },

    loadProjects: async function () {
      var listEl = $('#projects-list');
      var noProjectsEl = $('#no-projects');

      try {
        var data = await api('GET', '/api/status');

        listEl.innerHTML = '';

        if (!data.projects || data.projects.length === 0) {
          hide(listEl);
          show(noProjectsEl);
          return;
        }

        hide(noProjectsEl);
        show(listEl);

        data.projects.forEach(function (project) {
          var card = document.createElement('div');
          card.className = 'project-card';

          var statusBadge = project.running
            ? '<span class="badge badge-running">Running</span>'
            : '<span class="badge badge-stopped">Stopped</span>';

          var dateStr = '';
          if (project.createdAt) {
            try {
              dateStr = new Date(project.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });
            } catch (e) {
              dateStr = project.createdAt;
            }
          }

          card.innerHTML =
            '<div class="project-info">' +
              '<span class="project-name">' + escapeHtml(project.name) + '</span>' +
              (dateStr ? '<span class="project-date">Created ' + escapeHtml(dateStr) + '</span>' : '') +
            '</div>' +
            statusBadge;

          listEl.appendChild(card);
        });
      } catch (err) {
        listEl.innerHTML = '<div class="alert alert-error"><p>Failed to load projects.</p></div>';
      }
    },

    loadConfig: async function () {
      var configEl = $('#config-display');

      try {
        var data = await api('GET', '/api/config');

        var items = [
          { label: 'Discord Token', value: data.discord && data.discord.hasToken ? 'Configured' : 'Not set' },
          { label: 'Guild ID', value: data.discord ? data.discord.guildId : 'Not set' },
          { label: 'Claude Home', value: data.claudeHome || 'Not set' },
          { label: 'User ID', value: data.discord && data.discord.userId ? data.discord.userId : 'Not set', muted: !(data.discord && data.discord.userId) },
          { label: 'Role ID', value: data.discord && data.discord.roleId ? data.discord.roleId : 'Not set', muted: !(data.discord && data.discord.roleId) },
          { label: 'GitHub Token', value: data.github && data.github.hasToken ? 'Configured' : 'Not set', muted: !(data.github && data.github.hasToken) },
          { label: 'Git Name', value: data.git && data.git.userName ? data.git.userName : 'Not set', muted: !(data.git && data.git.userName) },
          { label: 'Git Email', value: data.git && data.git.userEmail ? data.git.userEmail : 'Not set', muted: !(data.git && data.git.userEmail) },
          { label: 'CLAUDE.md', value: data.hasClaudeMd ? 'Configured' : 'Not set', muted: !data.hasClaudeMd },
        ];

        var html = '<div class="config-grid">';
        items.forEach(function (item) {
          html +=
            '<div class="config-item">' +
              '<div class="config-label">' + escapeHtml(item.label) + '</div>' +
              '<div class="config-value' + (item.muted ? ' muted' : '') + '">' + escapeHtml(item.value) + '</div>' +
            '</div>';
        });
        html += '</div>';

        configEl.innerHTML = html;
      } catch (err) {
        configEl.innerHTML = '<div class="alert alert-error"><p>Failed to load configuration.</p></div>';
      }
    },

    reconfigure: function () {
      showWizard();
    },
  };

  // -------------------------------------------------------
  // Utility
  // -------------------------------------------------------

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
