/* ======================================================
   SUPABASE INTEGRATION — Altafacts Registry POS
   Project: yazxtykpdaqiwkajdrnb | Region: ca-central-1
   ====================================================== */
(function() {
  const SB_URL = 'https://yazxtykpdaqiwkajdrnb.supabase.co';
  const SB_KEY = 'sb_publishable__xwjACmscV2MHUI9mnVkKQ_wa2SUErb';
  window.SB_URL = SB_URL;
  window.SB_KEY = SB_KEY;
  window.SBURL = SB_URL;  // alias for window.SBURL checks
  window.SBKEY = SB_KEY;  // alias for window.SBKEY checks

  function currentAccessToken() {
    try { return JSON.parse(sessionStorage.getItem('registryPosSession') || 'null')?.accessToken || null; } catch (_) { return null; }
  }

  function sbHeaders(extra) {
    const token = currentAccessToken();
    return Object.assign({
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + (token || SB_KEY),
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }, extra || {});
  }

  function sbFetch(path, opts) {
    opts = opts || {};
    const headers = sbHeaders(opts.headers);
    return fetch(SB_URL + '/rest/v1/' + path, Object.assign({}, opts, { headers }));
  }
  window.sbFetch = sbFetch;
  window.sbHeaders = sbHeaders;

  /* ---- AUDIT LOGGING ---- */
  window.sbLogAudit = function(action, machineRef, entityType, entityId, detail, reason) {
    const user = (window.currentPrototypeUser && window.currentPrototypeUser.username) || 'unknown';
    sbFetch('audit_log', {
      method: 'POST',
      body: JSON.stringify({
        username: user, action: action,
        machine_ref: machineRef || '',
        entity_type: entityType || '',
        entity_id: String(entityId || ''),
        detail: detail || '',
        reason: reason || ''
      })
    }).catch(()=>{});
  };

  /* ---- CLIENTS: load from Supabase and replace inline array ---- */
  async function loadClients() {
    try {
      const res = await sbFetch('clients?select=*&order=name.asc&limit=1000');
      if (!res.ok) throw new Error('clients fetch failed: ' + res.status);
      const rows = await res.json();
      // Map DB columns back to camelCase used by the app
      const mapped = rows.map(r => ({
        id: r.id, name: r.name, contact: r.contact, phone: r.phone,
        fax: r.fax, email: r.email, address: r.address, city: r.city,
        province: r.province, postal: r.postal, active: r.active,
        gst: r.gst, invoiceBreakdown: r.invoice_breakdown,
        creditRisk: r.credit_risk, produceStatements: r.produce_statements,
        creditMax: r.credit_max, statementType: r.statement_type,
        forwardBy: r.forward_by, emailInclude: r.email_include,
        statementMessage: r.statement_message, alerts: r.alerts
      }));
      if (window.replaceRegistryPosClients) window.replaceRegistryPosClients(mapped);
      else window.registryPosClients = mapped;
      if (typeof populateTransactionClientOptions === 'function') populateTransactionClientOptions();
      console.info('[Supabase] Loaded ' + mapped.length + ' clients');
    } catch(e) {
      console.warn('[Supabase] Client load failed, using inline data:', e.message);
    }
  }

  /* ---- CATALOG: load from Supabase and replace inline array ---- */
  async function loadCatalog() {
    try {
      const res = await sbFetch('catalog?select=*&order=service_key.asc&limit=1000');
      if (!res.ok) throw new Error('catalog fetch failed: ' + res.status);
      const rows = await res.json();
      const mapped = rows.map(r => ({
        serviceKey: r.service_key, description: r.description,
        registryCharge: r.registry_charge, companyCharge: r.company_charge,
        posCode: r.pos_code, serviceGroup: r.service_group,
        gstRule: r.gst_rule, gsdEligible: r.gsd_eligible,
        payGovNowDefault: r.pay_gov_now_default
      }));
      window.registryPosCatalog = mapped;
      // Patch the app's getCatalog() to use live data
      if (typeof window._sbCatalogLoaded === 'undefined') {
        window._sbCatalogLoaded = true;
        const origGetCatalog = window.getCatalog;
        window.getCatalog = function(key) {
          if (!key) return window.registryPosCatalog;
          return window.registryPosCatalog.find(i => i.serviceKey === key) || null;
        };
      }
      if (typeof populateServiceProductLists === 'function') populateServiceProductLists();
      console.info('[Supabase] Loaded ' + mapped.length + ' catalog items');
    } catch(e) {
      console.warn('[Supabase] Catalog load failed, using inline data:', e.message);
    }
  }

  /* ---- CLIENT SAVE: write back to Supabase on save ---- */
  window.sbSaveClient = async function(clientObj) {
    const row = {
      id: clientObj.id, name: clientObj.name, contact: clientObj.contact,
      phone: clientObj.phone, fax: clientObj.fax, email: clientObj.email,
      address: clientObj.address, city: clientObj.city, province: clientObj.province,
      postal: clientObj.postal, active: clientObj.active, gst: clientObj.gst,
      invoice_breakdown: clientObj.invoiceBreakdown, credit_risk: clientObj.creditRisk,
      produce_statements: clientObj.produceStatements, credit_max: clientObj.creditMax,
      statement_type: clientObj.statementType, forward_by: clientObj.forwardBy,
      email_include: clientObj.emailInclude, statement_message: clientObj.statementMessage,
      alerts: clientObj.alerts
    };
    const res = await sbFetch('clients?id=eq.' + encodeURIComponent(clientObj.id), {
      method: 'PATCH',
      headers: sbHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify(row)
    });
    if (res.ok) {
      window.sbLogAudit('Client Saved', '', 'client', clientObj.id, clientObj.name, 'User edit');
    }
    return res.ok;
  };

  /* ---- TRANSACTION SAVE: upsert transaction + lines ---- */
  window.sbSaveTransaction = async function(txObj) {
    const txRow = {
      id: txObj.id, machine_ref: txObj.machineRef,
      transaction_date: txObj.date, transaction_time: txObj.time,
      client_label: txObj.clientLabel || 'Counter Sales',
      paid_by: txObj.paidBy, payment_amount: parseFloat((txObj.paymentAmount||'0').replace(/[^0-9.]/g,'')),
      posted: txObj.posted || false, created_by: txObj.createdBy || ''
    };
    const clientMatch = (txObj.clientLabel||'').match(/^(\d+)\s*-\s*/);
    if (clientMatch) txRow.client_id = clientMatch[1];
    await sbFetch('transactions?id=eq.' + encodeURIComponent(txObj.id), {
      method: 'PATCH', headers: sbHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify(txRow)
    }).then(r => r.ok ? r : sbFetch('transactions', {
      method: 'POST', body: JSON.stringify(txRow)
    }));
    window.sbLogAudit('Transaction Saved', txObj.machineRef, 'transaction', txObj.id, txObj.clientLabel, '');
  };

  /* ---- AUDIT LOG PAGE: load real log entries ---- */
  window.sbLoadAuditLog = async function(limit) {
    limit = limit || 200;
    const res = await sbFetch('audit_log?select=*&order=timestamp.desc&limit=' + limit);
    if (!res.ok) return [];
    return await res.json();
  };

  window.sbRenderAuditLog = async function() {
    const tbody = document.querySelector('#audit-maintenance-page .table-wrap tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="color:#667;padding:12px;">Loading…</td></tr>';
    const rows = await window.sbLoadAuditLog(500);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#667;padding:12px;">No audit entries yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => '<tr><td>' + escapeHtml(r.timestamp ? r.timestamp.replace('T',' ').slice(0,16) : '') +
      '</td><td>' + escapeHtml(r.username) +
      '</td><td>' + escapeHtml(r.action) +
      '</td><td>' + escapeHtml(r.machine_ref) +
      '</td><td>' + escapeHtml(r.reason) + '</td></tr>').join('');
  };

  /* ---- AUDIT LOG EXPORT ---- */
  window.sbExportAuditLog = async function() {
    const rows = await window.sbLoadAuditLog(10000);
    if (!rows.length) { alert('No audit log entries to export.'); return; }
    const cols = ['timestamp','username','action','machine_ref','entity_type','entity_id','detail','reason'];
    const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => '"' + String(r[c]||'').replace(/"/g,'""') + '"').join(','))).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'audit_log_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  };

  /* ---- WIRE AUDIT PAGE BUTTONS ---- */
  document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('audit-maintenance-page')?.addEventListener('click', function(e) {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.textContent.includes('View Full Audit Log') || btn.textContent.includes('Audit Review')) {
        window.sbRenderAuditLog();
      }
      if (btn.textContent.includes('Export Audit')) {
        window.sbExportAuditLog();
      }
    });

  
  // FIX C: Change Password page - populate fields on nav, wire Save & Clear buttons
  document.querySelectorAll('[data-open-page="change-password-page"],[data-nav="change-password-page"]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var u = (window.currentPrototypeUser && window.currentPrototypeUser.username) || '';
      var el = document.getElementById('chpwd-username');
      if (el) el.value = u;
      var lc = document.getElementById('chpwd-last-change');
      if (lc && !lc.value) lc.value = new Date().toISOString().slice(0,10);
    });
  });
  document.getElementById('chpwd-save-btn') && document.getElementById('chpwd-save-btn').addEventListener('click', async function() {
    var msg     = document.getElementById('chpwd-message');
    var current = (document.getElementById('chpwd-current') || {}).value || '';
    var newPwd  = (document.getElementById('chpwd-new')     || {}).value || '';
    var confirm = (document.getElementById('chpwd-confirm') || {}).value || '';
    if (!current)           { msg.textContent = 'Enter your current password.'; return; }
    if (newPwd.length < 12) { msg.textContent = 'New password must be at least 12 characters.'; return; }
    if (newPwd !== confirm)  { msg.textContent = 'New password and confirmation do not match.'; return; }
    msg.textContent = 'Verifying current password...';
    try {
      var session = JSON.parse(sessionStorage.getItem('registryPosSession') || 'null');
      var profileRes = session && session.username ? await window.sbFetch('profiles?select=email&username=eq.' + encodeURIComponent(session.username)) : null;
      var profileRows = (profileRes && profileRes.ok) ? await profileRes.json() : [];
      var authEmail = (profileRows[0] && profileRows[0].email) || ((session && session.username) + '@registrypos.local');
      var verifyRes = await fetch(window.SB_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'apikey': window.SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: current })
      });
      if (!verifyRes.ok) { msg.textContent = 'Current password is incorrect.'; return; }
      msg.textContent = 'Updating password...';
      var updateRes = await fetch(window.SB_URL + '/auth/v1/user', {
        method: 'PUT',
        headers: { 'apikey': window.SB_KEY, 'Authorization': 'Bearer ' + session.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPwd })
      });
      if (!updateRes.ok) {
        var err = await updateRes.json().catch(function(){ return {}; });
        msg.textContent = 'Password update failed: ' + (err.msg || err.error_description || 'Unknown error.');
        return;
      }
      var lc = document.getElementById('chpwd-last-change');
      if (lc) lc.value = new Date().toISOString().slice(0,10);
      document.getElementById('chpwd-current').value = '';
      document.getElementById('chpwd-new').value = '';
      document.getElementById('chpwd-confirm').value = '';
      msg.textContent = 'Password changed successfully ✓';
      window.sbLogAudit && window.sbLogAudit('Password Changed', '', 'user', session.username, '', 'User self-service');
    } catch(e) {
      msg.textContent = 'Error: ' + e.message;
    }
  });
  document.getElementById('chpwd-clear-btn') && document.getElementById('chpwd-clear-btn').addEventListener('click', function() {
    ['chpwd-current','chpwd-new','chpwd-confirm'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var msg = document.getElementById('chpwd-message');
    if (msg) msg.textContent = '';
  });

  // FIX D: Users & Roles nav - refresh user list when page is opened
  document.querySelectorAll('[data-open-page="users-roles-page"],[data-nav="users-roles-page"]').forEach(function(btn) {
    btn.addEventListener('click', function() { setTimeout(renderUsers, 150); });
  });

  // Auto-refresh audit log when the page becomes visible
    document.querySelectorAll('[data-open-page="audit-maintenance-page"],[data-nav="audit-maintenance-page"]').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(window.sbRenderAuditLog, 100));
    });
  });


  /* ---- HELPERS ---- */
  function moneyToNum(s) { return parseFloat((s || '0').replace(/[^0-9.-]/g,'')) || 0; }

  /* ---- TRANSACTION + LINES PERSIST (debounced 1.5s) ---- */
  const _sbPersistTimers = {};
  window.sbPersistTransaction = function(txId, immediate) {
    clearTimeout(_sbPersistTimers[txId]);
    if (immediate) { delete _sbPersistTimers[txId]; return _doSbPersist(txId); }
    _sbPersistTimers[txId] = setTimeout(() => _doSbPersist(txId), 1500);
  };
  window.sbFlushPendingPersist = function(txId) {
    if (_sbPersistTimers[txId]) { clearTimeout(_sbPersistTimers[txId]); delete _sbPersistTimers[txId]; return _doSbPersist(txId); }
    return Promise.resolve();
  };

  async function _doSbPersist(txId) {
    const txRow = document.querySelector(`.transaction-row[data-transaction="${txId}"]`);
    if (!txRow) return;
    const machineRef = txRow.dataset.machine || txId;
    const clientLabel = txRow.querySelector('.transaction-client-picker')?.value || txRow.children[3]?.textContent || 'Counter Sales';
    const clientIdMatch = clientLabel.match(/^(\d+)\s*-\s*/);
    const clientId = clientIdMatch ? clientIdMatch[1] : null;
    const tenders=currentTenderRows();
    const paidBy=tenders.map(t=>t.method).join(' + ')||'Acct';
    const payAmt=tenders.reduce((sum,t)=>sum+(parseFloat(t.amount)||0),0);
    const transactionRows=getLineRows();
    const fieldTotal=(label)=>transactionRows.reduce((sum,row)=>sum+moneyToNum(row.querySelector('[aria-label="'+label+'"]')?.value),0);
    const govTotal=fieldTotal('Government charge');
    const svcTotal=fieldTotal('Service charge');
    const gstTotal=fieldTotal('GST');
    const lineTotal=moneyToNum(document.getElementById('transaction-total')?.value);
    const txRecord = {
      id: txId, machine_ref: machineRef, client_label: clientLabel,
      ...(clientId ? {client_id: clientId} : {}),
      paid_by: paidBy, payment_amount: payAmt, tenders: tenders,
      gov_total: govTotal, svc_total: svcTotal, gst_total: gstTotal, line_total: lineTotal,
      created_by: (window.currentPrototypeUser?.username) || 'unknown'
    };

    /* upsert transaction header */
    await sbFetch('transactions?id=eq.' + encodeURIComponent(txId), {
      method: 'PATCH',
      headers: sbHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify(txRecord)
    }).then(r => r.ok ? r : sbFetch('transactions', {
      method: 'POST', headers: sbHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify(txRecord)
    }));

    /* replace lines: delete then insert */
    const lines = transactionLineSets[txId] || [];
    await sbFetch('transaction_lines?transaction_id=eq.' + encodeURIComponent(txId), {
      method: 'DELETE', headers: sbHeaders({'Prefer':'return=minimal'})
    });
    if (lines.length) {
      const lineRows = lines.map((l, i) => {
        /* service_key: only set if value looks like a catalog code, otherwise null */
        const rawSvc = (l.service || '').trim();
        const svcKey = rawSvc.length <= 10 && /^[A-Z0-9]{1,10}$/.test(rawSvc) ? rawSvc : null;
        return {
          transaction_id: txId, line_order: i,
          qty: parseInt(l.qty) || 1,
          ...(svcKey ? {service_key: svcKey} : {}),
          description: rawSvc, notes: l.notes || '',
          gov_charge: moneyToNum(l.govt), svc_charge: moneyToNum(l.serviceCharge),
          gst: moneyToNum(l.gst), gsd: !!l.gsd, pay_gov_now: !!l.payGovNow,
          govt_ref: l.ref || '',
          line_total: moneyToNum(l.lineTotal || l.govt)
        };
      });
      await sbFetch('transaction_lines', {
        method: 'POST', headers: sbHeaders({'Prefer':'return=minimal'}),
        body: JSON.stringify(lineRows)
      });
    }
    window.sbLogAudit('Transaction Lines Saved', machineRef, 'transaction', txId, clientLabel, '');
    const msg = document.querySelector('.line-save-message');
    if (msg) { msg.textContent = 'Saved to database ✓'; setTimeout(() => { if(msg.textContent==='Saved to database ✓') msg.textContent=''; }, 3000); }
  }

  /* ---- LOAD TODAY'S TRANSACTIONS FROM SUPABASE ---- */
  async function loadTransactions() {
    try {
      const today = new Date().toISOString().slice(0,10);
      const res = await sbFetch('transactions?select=*,transaction_lines(*)&transaction_date=eq.' + today + '&order=created_at.desc&limit=200');
      if (!res.ok) throw new Error('tx fetch ' + res.status);
      const txRows = await res.json();
      if (!txRows.length) return;

      const list = document.querySelector('.transaction-list tbody');
      if (!list) return;

      txRows.forEach(tx => {
        /* skip if already in the DOM (e.g. prototype seed rows) */
        if (document.querySelector(`.transaction-row[data-transaction="${tx.id}"]`)) return;

        /* rebuild transactionLineSets from loaded lines */
        const lines = (tx.transaction_lines || []).sort((a,b) => a.line_order - b.line_order).map(l => ({
          qty: String(l.qty || 1), service: l.description || '', notes: l.notes || '',
          govt: '$' + (parseFloat(l.gov_charge)||0).toFixed(2),
          serviceCharge: '$' + (parseFloat(l.svc_charge)||0).toFixed(2),
          gst: '$' + (parseFloat(l.gst)||0).toFixed(2),
          gsd: !!l.gsd, payGovNow: !!l.pay_gov_now,
          price: l.service_key || '', ref: l.govt_ref || '',
          lineTotal: '$' + (parseFloat(l.line_total)||0).toFixed(2)
        }));
        transactionLineSets[tx.id] = lines.length ? lines : [{qty:'1',service:'',notes:'',govt:'$0.00',serviceCharge:'$0.00',gst:'$0.00',gsd:false,payGovNow:false,price:'',ref:''}];
        transactionExtraDetails[tx.id] = {info:'', contact:''};
        transactionPayments[tx.id] = {paidBy: tx.paid_by || 'Acct', amount: parseFloat(tx.payment_amount)||0, tenders:Array.isArray(tx.tenders)&&tx.tenders.length?tx.tenders:[{method:tx.paid_by||'Acct',amount:parseFloat(tx.payment_amount)||0}], cheque:''};

        const row = document.createElement('tr');
        row.className = 'transaction-row';
        row.dataset.transaction = tx.id;
        row.dataset.machine = tx.machine_ref;
        const dateStr = tx.transaction_date || today;
        const timeStr = (tx.transaction_time || '').slice(0,5) || '—';
        const govT = '$' + (parseFloat(tx.gov_total)||0).toFixed(2);
        const svcT = '$' + (parseFloat(tx.svc_total)||0).toFixed(2);
        const gstT = '$' + (parseFloat(tx.gst_total)||0).toFixed(2);
        const linT = '$' + (parseFloat(tx.line_total)||0).toFixed(2);
        const paidBy = tx.paid_by || 'Acct';
        const payAmt = '$' + (parseFloat(tx.payment_amount)||0).toFixed(2);
        row.innerHTML = '<td>' + escapeHtml(tx.machine_ref) + '</td><td>' + escapeHtml(dateStr) + '</td><td>' + escapeHtml(timeStr) + '</td>' +
          '<td><input class="transaction-client-picker" list="transaction-client-options" aria-label="Client for this transaction" value="' + escapeHtml(tx.client_label||'Counter Sales') + '"></td>' +
          '<td>' + escapeHtml(govT) + '</td><td>' + escapeHtml(svcT) + '</td><td>' + escapeHtml(gstT) + '</td><td>' + escapeHtml(linT) + '</td>' +
          '<td>' + escapeHtml(paidBy) + '</td><td>' + escapeHtml(payAmt) + '</td>' +
          '<td><input class="transaction-cust-name" aria-label="Customer name for this transaction" placeholder="Customer name" value=""></td>';
        row.addEventListener('click', () => selectTransaction(row));
        list.appendChild(row);
      });

      if (typeof updateTransactionListHeight === 'function') updateTransactionListHeight();
      console.info('[Supabase] Loaded ' + txRows.length + " today's transactions");
    } catch(e) {
      console.warn('[Supabase] Transaction load failed:', e.message);
    }
  }

  /* ---- INIT: only fetch protected data after authentication, and coalesce calls. ---- */
  let initialDataLoad;
  window.sbLoadInitialData = function() {
    if (!currentAccessToken()) return Promise.resolve();
    if (!initialDataLoad) initialDataLoad = Promise.all([loadClients(), loadCatalog(), loadTransactions()])
      .finally(() => { initialDataLoad = null; });
    return initialDataLoad;
  };
  window.addEventListener('DOMContentLoaded', () => window.sbLoadInitialData());



  /* ---- INBOUND POS FTP RECEIVER SETTINGS ---- */
  const FTP_CONNECTION_KEY = 'registryPosFtpConnection';
  function getFtpConnection() { try { return JSON.parse(localStorage.getItem(FTP_CONNECTION_KEY) || '{}'); } catch(e) { return {}; } }
  function setFtpConnectionSummary() {
    const c = getFtpConnection(), summary = document.getElementById('ftp-connection-type');
    if (summary) summary.value = c.senderIp ? `${c.type || 'FTP'} inbound — ${c.senderIp}:${c.port || '21'}` : 'Not configured';
  }
  function openFtpSettings() {
    const c = getFtpConnection();
    document.getElementById('ftp-modal-connection-type').value = c.type || 'FTP';
    document.getElementById('ftp-modal-sender-ip').value = c.senderIp || '';
    document.getElementById('ftp-modal-port').value = c.port || '21';
    document.getElementById('ftp-modal-local-folder').value = c.localFolder || localStorage.getItem('registryPosFtpDownloadFolder') || '';
    document.getElementById('ftp-modal-worker-endpoint').value = localStorage.getItem('registryPosImportWorkerEndpoint') || '';
    document.getElementById('ftp-modal-after-import').value = c.afterImport || 'retain';
    document.getElementById('ftp-modal-username').value = c.username || '';
    document.getElementById('ftp-modal-password').value = c.password || '';
    document.getElementById('ftp-modal-passive').checked = c.passive !== false;
    document.getElementById('ftp-settings-status').textContent = c.senderIp ? 'Saved receiver settings loaded. Testing mode retains imported *.rsgdata files; live mode moves successful imports to Trash.' : 'Enter the one trusted sender IP and the local folder where incoming .rsgdata files will be placed.';
    document.getElementById('ftp-settings-modal').classList.add('open');
    setTimeout(() => document.getElementById('ftp-modal-sender-ip').focus(), 50);
  }
  function closeFtpSettings() { document.getElementById('ftp-settings-modal')?.classList.remove('open'); }
  function readFtpConnectionForm() { return { type:document.getElementById('ftp-modal-connection-type').value, senderIp:document.getElementById('ftp-modal-sender-ip').value.trim(), port:document.getElementById('ftp-modal-port').value.trim(), localFolder:document.getElementById('ftp-modal-local-folder').value.trim(), workerEndpoint:document.getElementById('ftp-modal-worker-endpoint').value.trim(), username:document.getElementById('ftp-modal-username').value.trim(), password:document.getElementById('ftp-modal-password').value, passive:document.getElementById('ftp-modal-passive').checked, afterImport:document.getElementById('ftp-modal-after-import').value, filePattern:'*.rsgdata' }; }
  function isValidIpv4(value) { const p=value.split('.'); return p.length===4 && p.every(n => /^\d+$/.test(n) && +n>=0 && +n<=255); }
  document.addEventListener('DOMContentLoaded', function() {
    setFtpConnectionSummary();
    document.getElementById('ftp-open-settings-btn')?.addEventListener('click', openFtpSettings);
    document.getElementById('ftp-settings-close-btn')?.addEventListener('click', closeFtpSettings);
    document.getElementById('ftp-settings-modal')?.addEventListener('click', e => { if (e.target.id === 'ftp-settings-modal') closeFtpSettings(); });
    document.getElementById('ftp-modal-connection-type')?.addEventListener('change', e => { document.getElementById('ftp-modal-port').value = e.target.value === 'SFTP' ? '22' : (e.target.value === 'FTPS' ? '990' : '21'); });
    document.getElementById('ftp-settings-test-btn')?.addEventListener('click', function() {
      const c=readFtpConnectionForm(), message=document.getElementById('ftp-settings-status');
      if (!isValidIpv4(c.senderIp)) { message.textContent='Enter one valid IPv4 address for the approved sender.'; return; }
      if (!c.localFolder) { message.textContent='Enter the local landing folder for incoming .rsgdata files.'; return; }
      message.textContent=`Valid receiver configuration: accept *.rsgdata files only from ${c.senderIp} on port ${c.port || '21'}, place them in ${c.localFolder}, then ${c.afterImport === 'trash' ? 'move successful imports to Trash' : 'retain source files for testing'}.`;
    });
    document.getElementById('ftp-settings-save-btn')?.addEventListener('click', function() {
      const c=readFtpConnectionForm(), message=document.getElementById('ftp-settings-status');
      if (!isValidIpv4(c.senderIp)) { message.textContent='Enter one valid IPv4 address for the approved sender before saving.'; return; }
      if (!c.localFolder) { message.textContent='Enter the local landing folder before saving.'; return; }
      if (!c.port) c.port=c.type==='SFTP'?'22':(c.type==='FTPS'?'990':'21');
      localStorage.setItem(FTP_CONNECTION_KEY,JSON.stringify(c));
      localStorage.setItem('registryPosFtpDownloadFolder',c.localFolder);
      localStorage.setItem('registryPosImportWorkerEndpoint',c.workerEndpoint);
      const mainFolder=document.getElementById('ftp-download-folder'); if(mainFolder) mainFolder.value=c.localFolder;
      setFtpConnectionSummary();
      message.textContent=`Receiver settings saved. Allow only ${c.senderIp} to send *.rsgdata files; ${c.afterImport === 'trash' ? 'successful imports will move to Trash.' : 'testing mode will retain files.'}`;
      window.sbLogAudit?.('Inbound POS FTP Settings Saved','', 'import_settings','',c.senderIp,'*.rsgdata inbound receiver');
      setTimeout(closeFtpSettings,550);
    });
  });
  /* ---- IMPORTED RSGDATA TRANSACTIONS -> SUPABASE ---- */
  window.sbSaveImportedTransactions = async function(importedTransactions) {
    const transactions = Array.isArray(importedTransactions) ? importedTransactions : [];
    let savedTransactions = 0, savedLines = 0, unmatchedLines = 0;
    for (let txIndex = 0; txIndex < transactions.length; txIndex++) {
      const source = transactions[txIndex] || {};
      const machineRef = String(source.machineRef || source.machine_ref || source.machineReference || source.machineref || '').trim();
      if (!machineRef) continue;
      const txId = String(source.id || source.transactionId || source.transaction_id || ('IMP-' + machineRef)).trim();
      const rawLines = Array.isArray(source.lines) ? source.lines : (Array.isArray(source.transactionLines) ? source.transactionLines : []);
      const num = value => parseFloat(String(value ?? '0').replace(/[^0-9.-]/g,'')) || 0;
      const date = String(source.transactionDate || source.transaction_date || new Date().toISOString().slice(0,10)).slice(0,10);
      const time = String(source.transactionTime || source.transaction_time || new Date().toTimeString().slice(0,8)).slice(0,8);
      const lineTotal = rawLines.reduce((sum,line) => sum + num(line.lineTotal || line.line_total || line.total || (num(line.govCharge || line.gov_charge) + num(line.svcCharge || line.svc_charge) + num(line.gst))), 0);
      const txRow = {id:txId,machine_ref:machineRef,transaction_date:date,transaction_time:time,client_label:source.clientLabel || source.client_label || 'Counter Sales',paid_by:source.paidBy || source.paid_by || 'Acct',payment_amount:num(source.paymentAmount || source.payment_amount),gov_total:rawLines.reduce((s,l)=>s+num(l.govCharge || l.gov_charge),0),svc_total:rawLines.reduce((s,l)=>s+num(l.svcCharge || l.svc_charge),0),gst_total:rawLines.reduce((s,l)=>s+num(l.gst),0),line_total:lineTotal,posted:false,created_by:(window.currentPrototypeUser?.username)||'RSGDATA Import'};
      const clientMatch = String(txRow.client_label).match(/^(\d+)\s*-\s*/); if(clientMatch) txRow.client_id=clientMatch[1];
      const patch = await sbFetch('transactions?id=eq.'+encodeURIComponent(txId),{method:'PATCH',headers:sbHeaders({'Prefer':'return=minimal'}),body:JSON.stringify(txRow)});
      if (!patch.ok) { const insert=await sbFetch('transactions',{method:'POST',headers:sbHeaders({'Prefer':'return=minimal'}),body:JSON.stringify(txRow)}); if(!insert.ok) throw new Error('Could not save transaction '+machineRef); }
      await sbFetch('transaction_lines?transaction_id=eq.'+encodeURIComponent(txId),{method:'DELETE',headers:sbHeaders({'Prefer':'return=minimal'})});
      const dbLines = rawLines.map((line,index) => {
        const posCode=String(line.posCode || line.pos_code || line.serviceKey || line.service_key || '').trim();
        const catalogItem=(window.registryPosCatalog || []).find(c=>String(c.posCode||'').toUpperCase()===posCode.toUpperCase() || String(c.serviceKey||'').toUpperCase()===posCode.toUpperCase());
        if(!catalogItem && posCode) unmatchedLines++;
        const gov=num(line.govCharge || line.gov_charge || line.governmentCharge), svc=num(line.svcCharge || line.svc_charge || line.serviceCharge), gst=num(line.gst), total=num(line.lineTotal || line.line_total || line.total) || gov+svc+gst;
        return {transaction_id:txId,line_order:index,qty:parseInt(line.qty || line.quantity)||1,...(catalogItem?{service_key:catalogItem.serviceKey}:{}),description:catalogItem?.description || line.description || line.serviceDescription || posCode || '',notes:line.notes || '',gov_charge:gov,svc_charge:svc,gst:gst,gsd:!!(line.gsd || line.gsdEligible),pay_gov_now:!!(line.payGovNow || line.pay_gov_now),govt_ref:String(line.govRef || line.govtRef || line.governmentReference || line.referenceNumber || line.reference_number || ''),line_total:total};
      });
      if(dbLines.length) { const lineInsert=await sbFetch('transaction_lines',{method:'POST',headers:sbHeaders({'Prefer':'return=minimal'}),body:JSON.stringify(dbLines)}); if(!lineInsert.ok) throw new Error('Could not save lines for '+machineRef); savedLines+=dbLines.length; }
      savedTransactions++;
    }
    return {savedTransactions,savedLines,unmatchedLines};
  }

  window.sbRetrieveRsgdataIntoTransactions = async function() {
    const ftp = getFtpConnection();
    const folder = localStorage.getItem('registryPosFtpDownloadFolder') || ftp.localFolder || '';
    const endpoint = localStorage.getItem('registryPosImportWorkerEndpoint') || '';
    if (!ftp.senderIp) throw new Error('Configure the GOA approved sender IP in FTP Settings first.');
    if (!folder) throw new Error('Save the Download Folder Address in FTP / Import Settings first.');
    if (!endpoint) throw new Error('Save the Import Receiver Service URL in FTP Settings first.');
    const response = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retrieve_and_import',senderIp:ftp.senderIp,folder:folder,filePattern:'*.rsgdata',afterImport:ftp.afterImport || 'retain',trashFolder:(ftp.afterImport === 'trash' ? folder.replace(/[\\/]?$/, '\\Trash') : '')})});
    if (!response.ok) throw new Error('GOA import receiver returned ' + response.status + '.');
    const result = await response.json();
    const imported = result.transactions || result.importedTransactions || [];
    const saved = await window.sbSaveImportedTransactions(imported);
    return {result, imported, saved};
  };
  window.sbLoadImportedLinesIntoEditor = function(imported) {
    const active = document.querySelector('.transaction-row.selected');
    if (!active || !imported?.length) return false;
    const activeMachine = active.dataset.machine || active.children[0]?.textContent.trim();
    const source = imported.find(tx => String(tx.machineRef || tx.machine_ref || tx.machineReference || tx.machineref || '').trim() === String(activeMachine || '').trim()) || imported[0];
    const lines = Array.isArray(source.lines) ? source.lines : (Array.isArray(source.transactionLines) ? source.transactionLines : []);
    if (!lines.length) return false;
    const txId = active.dataset.transaction;
    transactionLineSets[txId] = lines.map(line => {
      const posCode=String(line.posCode || line.pos_code || line.serviceKey || line.service_key || '').trim();
      const item=(window.registryPosCatalog || []).find(c=>String(c.posCode||'').toUpperCase()===posCode.toUpperCase() || String(c.serviceKey||'').toUpperCase()===posCode.toUpperCase());
      const money=v => '$' + (parseFloat(String(v ?? '0').replace(/[^0-9.-]/g,'')) || 0).toFixed(2);
      return {qty:String(line.qty || line.quantity || 1),service:item?.description || line.description || line.serviceDescription || posCode,notes:line.notes || '',govt:money(line.govCharge || line.gov_charge || line.governmentCharge),serviceCharge:money(line.svcCharge || line.svc_charge || line.serviceCharge),gst:money(line.gst),gsd:!!(line.gsd || line.gsdEligible),payGovNow:!!(line.payGovNow || line.pay_gov_now),price:item?.serviceKey || posCode,ref:String(line.govRef || line.govtRef || line.governmentReference || line.referenceNumber || line.reference_number || ''),lineTotal:money(line.lineTotal || line.line_total || line.total)};
    });
    selectTransaction(active);
    return true;
  };

  /* ---- FTP / IMPORT FOLDER SETTINGS ---- */
  const FTP_FOLDER_KEY = 'registryPosFtpDownloadFolder';
  const FTP_HISTORY_KEY = 'registryPosImportHistory';
  function ftpEsc(value) { return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renderFtpHistory() {
    const body = document.getElementById('ftp-import-history-body');
    if (!body) return;
    let history = []; try { history = JSON.parse(localStorage.getItem(FTP_HISTORY_KEY) || '[]'); } catch(e) {}
    body.innerHTML = history.length ? history.map(row => '<tr><td>'+ftpEsc(row.batchId)+'</td><td>'+ftpEsc(row.importedAt)+'</td><td>'+ftpEsc(row.rows)+'</td><td>'+ftpEsc(row.matched)+'</td><td>'+ftpEsc(row.unmatched)+'</td><td>'+ftpEsc(row.status)+'</td></tr>').join('') : '<tr><td colspan="6">No import batches have been run in this browser.</td></tr>';
  }
  document.addEventListener('DOMContentLoaded', function() {
    const address = document.getElementById('ftp-download-folder');
    const status = document.getElementById('ftp-folder-status');
    const picker = document.getElementById('ftp-folder-picker');
    const saved = localStorage.getItem(FTP_FOLDER_KEY) || '';
    if (address) address.value = saved;
    renderFtpHistory();

    document.getElementById('ftp-save-folder-btn')?.addEventListener('click', function() {
      const value = address?.value.trim() || '';
      if (!value) { status.textContent = 'Enter or choose a download-folder address before saving.'; return; }
      localStorage.setItem(FTP_FOLDER_KEY, value);
      status.textContent = 'Download folder address saved: ' + value;
      window.sbLogAudit?.('Import Folder Address Saved', '', 'import_settings', '', value, '');
    });
    document.getElementById('ftp-browse-folder-btn')?.addEventListener('click', async function() {
      if (window.showDirectoryPicker) {
        try {
          const folder = await window.showDirectoryPicker({mode:'read'});
          address.value = folder.name;
          status.textContent = 'Selected local folder: ' + folder.name + '. Select Save Address to retain this label.';
          return;
        } catch(e) { if (e.name !== 'AbortError') status.textContent = 'Folder selection was unavailable. Enter the folder address manually.'; return; }
      }
      picker?.click();
    });
    picker?.addEventListener('change', function() {
      const first = picker.files?.[0];
      if (!first) return;
      const folder = first.webkitRelativePath.split('/')[0];
      address.value = folder;
      status.textContent = 'Selected local folder: ' + folder + '. Select Save Address to retain this label.';
    });
    document.getElementById('ftp-view-history-btn')?.addEventListener('click', renderFtpHistory);
    document.getElementById('ftp-run-import-btn')?.addEventListener('click', async function() {
      const value = address?.value.trim() || '';
      const ftp = getFtpConnection();
      if (!value) { status.textContent = 'Save a Download Folder Address before running an import.'; address?.focus(); return; }
      if (!ftp.senderIp) { status.textContent = 'Configure the approved sender IP in FTP Settings before running an import.'; document.getElementById('ftp-open-settings-btn')?.focus(); return; }
      status.textContent = 'Requesting *.rsgdata files from the inbound FTP receiver…';
      const button = document.getElementById('ftp-run-import-btn'); button.disabled = true;
      try {
        const endpoint = localStorage.getItem('registryPosImportWorkerEndpoint') || '';
        if (!endpoint) throw new Error('Import worker not connected');
        const response = await fetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'retrieve_and_import', senderIp:ftp.senderIp, folder:value, filePattern:'*.rsgdata', afterImport:ftp.afterImport || 'retain', trashFolder:(ftp.afterImport === 'trash' ? value.replace(/[\\/]?$/, '\\Trash') : '')})});
        if (!response.ok) throw new Error('Receiver returned ' + response.status);
        const result = await response.json();
        status.textContent = 'RSGDATA files received. Saving imported transactions and line items to the database…';
        const saved = await sbSaveImportedTransactions(result.transactions || result.importedTransactions || []);
        const now = new Date().toLocaleString('en-CA');
        const history = JSON.parse(localStorage.getItem(FTP_HISTORY_KEY) || '[]');
        history.unshift({batchId:result.batchId || ('IMP-'+Date.now()), importedAt:now, rows:result.rows || saved.savedLines, matched:result.matched || Math.max(0, saved.savedLines-saved.unmatchedLines), unmatched:result.unmatched || saved.unmatchedLines, status:'Saved to database'});
        localStorage.setItem(FTP_HISTORY_KEY,JSON.stringify(history.slice(0,100)));
        document.getElementById('ftp-last-import').value = now;
        renderFtpHistory();
        status.textContent = `Import complete: ${result.files || 0} *.rsgdata file(s) received to ${value}; ${saved.savedTransactions} transaction(s) and ${saved.savedLines} line item(s) saved to the database. ${result.unmatched || saved.unmatchedLines} POS code(s) need review. ${result.sourceFileAction || (ftp.afterImport === 'trash' ? 'Successful source files were moved to Trash.' : 'Testing mode: source files were retained in the landing folder.')}`;
        window.sbLogAudit?.('RSGDATA Import Saved to Database','', 'import', result.batchId || '', `${saved.savedTransactions} transactions; ${saved.savedLines} lines`, '');
      } catch(e) {
        status.textContent = 'Import receiver is not connected yet. The receiver service must fetch *.rsgdata from ' + ftp.senderIp + ', store the files in ' + value + ', then return the parsed machine references, government references, and POS-code match results.';
      } finally { button.disabled = false; }
    });
    document.getElementById('ftp-error-log-btn')?.addEventListener('click', function() {
      const blob = new Blob(['No import errors have been recorded.\n'], {type:'text/plain'});
      const link = document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='pos-import-errors.txt'; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    });
  });
})();
