/**
 * LedgerGuard — Client-side Operations Dashboard
 *
 * Drives synthetic banking demonstration features:
 * - Dynamic ledger-derived account balances
 * - Recent transaction history audit trail
 * - Transfer simulator with Idempotency-Key controls & conflict testing
 * - Continuous ledger reconciliation engine
 * - Account ledger breakdown modal
 *
 * Zero external dependencies (vanilla modern ES6+).
 */

// Generate standard UUID v4 locally
function generateUUID() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Format numbers as currency string
function formatCurrency(amountStr, currency = 'INR') {
  if (amountStr === null || amountStr === undefined) return '0.0000 ' + currency;
  const num = parseFloat(amountStr);
  const formatted = isNaN(num) ? '0.0000' : num.toLocaleString('en-IN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  return `${currency} ${formatted}`;
}

// Format timestamp
function formatDateTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Copy to clipboard helper
async function copyToClipboard(text, element) {
  try {
    await navigator.clipboard.writeText(text);
    const originalText = element.getAttribute('data-copied') || element.innerHTML;
    element.innerHTML = '✓ Copied!';
    setTimeout(() => {
      element.innerHTML = originalText;
    }, 1200);
  } catch (err) {
    console.warn('Clipboard write failed', err);
  }
}

// Global cache for account data
let cachedAccounts = [];

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  generateNewIdempotencyKey();
  refreshAllData();
});

function setupEventListeners() {
  // Transfer Form Submit
  const transferForm = document.getElementById('transferForm');
  if (transferForm) {
    transferForm.addEventListener('submit', handleTransferSubmit);
  }

  // Idempotency Key buttons
  const btnNewKey = document.getElementById('btnNewKey');
  if (btnNewKey) {
    btnNewKey.addEventListener('click', () => {
      generateNewIdempotencyKey();
      showSimulatorToast('Generated fresh Idempotency-Key');
    });
  }

  const btnReplayTest = document.getElementById('btnReplayTest');
  if (btnReplayTest) {
    btnReplayTest.addEventListener('click', () => {
      showSimulatorToast('Submitting identical payload with same key (Expect HTTP 200 Replayed)...');
      executeTransferRequest();
    });
  }

  const btnConflictTest = document.getElementById('btnConflictTest');
  if (btnConflictTest) {
    btnConflictTest.addEventListener('click', () => {
      const amountInput = document.getElementById('transferAmount');
      const curAmount = parseFloat(amountInput.value) || 10;
      amountInput.value = (curAmount + 5).toFixed(4);
      showSimulatorToast('Mutated amount with same key (Expect HTTP 409 Conflict)...');
      executeTransferRequest();
    });
  }

  const btnSwap = document.getElementById('btnSwapAccounts');
  if (btnSwap) {
    btnSwap.addEventListener('click', swapTransferAccounts);
  }

  // Global Refresh Button
  const btnRefresh = document.getElementById('btnRefreshAll');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', refreshAllData);
  }

  // Reconciliation Trigger Button
  const btnRecon = document.getElementById('btnRunReconciliation');
  if (btnRecon) {
    btnRecon.addEventListener('click', () => {
      loadReconciliation(true);
    });
  }

  // Modal Close
  const btnCloseModal = document.getElementById('btnCloseModal');
  const modalOverlay = document.getElementById('ledgerModal');
  if (btnCloseModal && modalOverlay) {
    btnCloseModal.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
    });
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.remove('active');
    });
  }

  // Account search filter
  const accountFilter = document.getElementById('accountFilter');
  if (accountFilter) {
    accountFilter.addEventListener('input', (e) => {
      renderAccountsTable(e.target.value.trim().toLowerCase());
    });
  }
}

function generateNewIdempotencyKey() {
  const keyInput = document.getElementById('idempotencyKey');
  if (keyInput) {
    keyInput.value = generateUUID();
  }
}

function swapTransferAccounts() {
  const src = document.getElementById('sourceAccountId');
  const dst = document.getElementById('destinationAccountId');
  if (src && dst) {
    const temp = src.value;
    src.value = dst.value;
    dst.value = temp;
  }
}

function showSimulatorToast(msg) {
  const note = document.getElementById('simulatorQuickNote');
  if (note) {
    note.textContent = msg;
    note.style.opacity = '1';
    setTimeout(() => {
      note.style.opacity = '0';
    }, 3000);
  }
}

// Refresh all sections
async function refreshAllData() {
  const btn = document.getElementById('btnRefreshAll');
  if (btn) btn.classList.add('loading');

  try {
    await Promise.all([
      loadAccounts(),
      loadTransactions(),
      loadReconciliation(),
    ]);
  } catch (err) {
    console.error('Error refreshing dashboard:', err);
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// Load Accounts
async function loadAccounts() {
  try {
    const res = await fetch('/dashboard/api/accounts');
    const json = await res.json();
    if (json.status === 'success') {
      cachedAccounts = json.data || [];
      renderAccountsTable();
      populateAccountSelectors();
      updateAccountStats();
    }
  } catch (err) {
    console.error('Failed to load accounts:', err);
  }
}

function updateAccountStats() {
  const countEl = document.getElementById('statTotalAccounts');
  const balEl = document.getElementById('statTotalLiquidity');

  if (countEl) countEl.textContent = cachedAccounts.length;

  if (balEl) {
    let totalBal = 0;
    cachedAccounts.forEach(acc => {
      totalBal += parseFloat(acc.balance || 0);
    });
    balEl.textContent = formatCurrency(totalBal.toFixed(4), 'INR');
  }
}

function populateAccountSelectors() {
  const srcSelect = document.getElementById('sourceAccountId');
  const dstSelect = document.getElementById('destinationAccountId');
  if (!srcSelect || !dstSelect) return;

  const curSrc = srcSelect.value;
  const curDst = dstSelect.value;

  const makeOptions = (filterId) => {
    return cachedAccounts
      .map(acc => {
        const desc = acc.description ? ` (${acc.description})` : '';
        const shortId = acc.id.substring(0, 8);
        return `<option value="${acc.id}">[${shortId}] ${acc.user_id}${desc} — ₹${acc.balance}</option>`;
      })
      .join('');
  };

  srcSelect.innerHTML = '<option value="">Select source account...</option>' + makeOptions();
  dstSelect.innerHTML = '<option value="">Select destination account...</option>' + makeOptions();

  if (curSrc) srcSelect.value = curSrc;
  if (curDst) dstSelect.value = curDst;

  // Default selection if empty and we have at least 2 accounts
  if (!srcSelect.value && cachedAccounts.length >= 2) {
    srcSelect.value = cachedAccounts[0].id;
    dstSelect.value = cachedAccounts[1].id;
  }
}

function renderAccountsTable(searchQuery = '') {
  const tbody = document.getElementById('accountsTableBody');
  if (!tbody) return;

  const filtered = cachedAccounts.filter(acc => {
    if (!searchQuery) return true;
    return (
      acc.id.toLowerCase().includes(searchQuery) ||
      (acc.user_id && acc.user_id.toLowerCase().includes(searchQuery)) ||
      (acc.description && acc.description.toLowerCase().includes(searchQuery))
    );
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">No accounts found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(acc => {
      const typeBadge = acc.account_type === 'checking'
        ? '<span class="badge badge-indigo">Checking</span>'
        : '<span class="badge badge-emerald">Savings</span>';

      const statusBadge = acc.status === 'active'
        ? '<span class="badge badge-emerald">Active</span>'
        : '<span class="badge badge-rose">Frozen</span>';

      const isPositive = parseFloat(acc.balance) > 0;
      const balClass = isPositive ? 'amount-positive' : 'text-muted';

      return `
        <tr>
          <td>
            <span class="uuid-badge" title="Click to copy full UUID" onclick="copyToClipboard('${acc.id}', this)" data-copied="${acc.id.substring(0, 8)}...">
              ${acc.id.substring(0, 8)}...
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </span>
          </td>
          <td>
            <div style="font-weight: 500;">${escapeHtml(acc.user_id)}</div>
            <div style="font-size: 0.725rem; color: var(--text-muted);">${escapeHtml(acc.description || 'Standard Account')}</div>
          </td>
          <td>${typeBadge}</td>
          <td>${statusBadge}</td>
          <td class="amount-display ${balClass}">${formatCurrency(acc.balance, acc.currency)}</td>
          <td>
            <div class="btn-group">
              <button class="btn btn-secondary btn-sm" onclick="setTransferAccounts('${acc.id}', 'source')" title="Set as Source">From</button>
              <button class="btn btn-secondary btn-sm" onclick="setTransferAccounts('${acc.id}', 'dest')" title="Set as Destination">To</button>
              <button class="btn btn-secondary btn-sm" onclick="viewAccountLedger('${acc.id}')" title="Inspect Ledger Entries">Audit</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

window.setTransferAccounts = function (id, role) {
  if (role === 'source') {
    const el = document.getElementById('sourceAccountId');
    if (el) el.value = id;
    showSimulatorToast('Source account set to ' + id.substring(0, 8));
  } else {
    const el = document.getElementById('destinationAccountId');
    if (el) el.value = id;
    showSimulatorToast('Destination account set to ' + id.substring(0, 8));
  }
};

// Load Transactions
async function loadTransactions() {
  try {
    const res = await fetch('/dashboard/api/transactions');
    const json = await res.json();
    if (json.status === 'success') {
      renderTransactionsTable(json.data || []);
      const countEl = document.getElementById('statTotalTransactions');
      if (countEl) countEl.textContent = (json.data || []).length;
    }
  } catch (err) {
    console.error('Failed to load transactions:', err);
  }
}

function renderTransactionsTable(transactions) {
  const tbody = document.getElementById('transactionsTableBody');
  if (!tbody) return;

  if (transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">No transaction history yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = transactions
    .slice(0, 20)
    .map(tx => {
      let typeBadge = '<span class="badge badge-indigo">Transfer</span>';
      if (tx.type === 'deposit') typeBadge = '<span class="badge badge-emerald">Deposit</span>';
      if (tx.type === 'withdrawal') typeBadge = '<span class="badge badge-amber">Withdrawal</span>';

      let statusBadge = '<span class="badge badge-emerald">Completed</span>';
      if (tx.status === 'pending') statusBadge = '<span class="badge badge-amber">Pending</span>';
      if (tx.status === 'failed') statusBadge = '<span class="badge badge-rose">Failed</span>';

      const srcText = tx.source_account_id ? `${tx.source_account_id.substring(0, 8)}...` : '—';
      const dstText = tx.destination_account_id ? `${tx.destination_account_id.substring(0, 8)}...` : '—';

      return `
        <tr>
          <td>
            <span class="uuid-badge" onclick="copyToClipboard('${tx.id}', this)" data-copied="${tx.id.substring(0, 8)}...">
              ${tx.id.substring(0, 8)}...
            </span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.75rem;">${formatDateTime(tx.created_at)}</td>
          <td>${typeBadge}</td>
          <td class="font-mono" style="font-size: 0.75rem;">${srcText} &rarr; ${dstText}</td>
          <td class="amount-display">${formatCurrency(tx.amount, tx.currency)}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    })
    .join('');
}

// Load Ledger Reconciliation
async function loadReconciliation(manual = false) {
  const statusBadge = document.getElementById('reconStatusBadge');
  const detailsBox = document.getElementById('reconDetailsContainer');
  const statBadge = document.getElementById('statReconBadge');
  const btn = document.getElementById('btnRunReconciliation');

  if (manual && btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Auditing...';
  }

  try {
    const res = await fetch('/reports/reconciliation');
    const json = await res.json();

    if (json.status === 'success') {
      const data = json.data;
      const isBalanced = data.summary.reconciliationStatus === 'BALANCED' || data.summary.discrepancyCount === 0;
      const findings = data.findings || [];

      // Update Header & Stat Badge
      if (statBadge) {
        if (isBalanced) {
          statBadge.className = 'badge badge-emerald';
          statBadge.textContent = '100% Balanced';
        } else {
          statBadge.className = 'badge badge-rose';
          statBadge.textContent = `${data.summary.discrepancyCount} Discrepancies`;
        }
      }

      // Update Card
      const card = document.getElementById('reconCard');
      if (card) {
        if (isBalanced) {
          card.className = 'recon-card';
        } else {
          card.className = 'recon-card has-discrepancy';
        }
      }

      if (statusBadge) {
        if (isBalanced) {
          statusBadge.innerHTML = `
            <span style="color: var(--accent-emerald); display: flex; align-items: center; gap: 0.4rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              LEGAL DOUBLE-ENTRY BALANCED
            </span>
          `;
        } else {
          statusBadge.innerHTML = `
            <span style="color: var(--accent-rose); display: flex; align-items: center; gap: 0.4rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              INTEGRITY DISCREPANCIES DETECTED
            </span>
          `;
        }
      }

      // Metrics
      const mTx = document.getElementById('reconMetricTransactions');
      const mValid = document.getElementById('reconMetricValid');
      const mDisc = document.getElementById('reconMetricDiscrepancies');
      const mDelta = document.getElementById('reconMetricDelta');

      if (mTx) mTx.textContent = data.summary.completedTransactionsChecked ?? '0';
      if (mValid) mValid.textContent = data.summary.validTransactions ?? '0';
      if (mDisc) mDisc.textContent = data.summary.discrepancyCount ?? '0';
      if (mDelta) {
        mDelta.textContent = isBalanced ? 'Balanced (Zero Imbalance)' : `${data.summary.discrepancyCount} Discrepancies`;
        mDelta.style.color = isBalanced ? 'var(--accent-emerald)' : 'var(--accent-rose)';
      }

      // Findings list
      if (detailsBox) {
        if (isBalanced || findings.length === 0) {
          detailsBox.innerHTML = `
            <div style="font-size: 0.775rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-emerald)" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Every completed transaction in the database adheres to double-entry conservation laws (Debit = Credit = Transaction Amount).
            </div>
          `;
        } else {
          detailsBox.innerHTML = `
            <div style="font-weight: 600; color: var(--accent-rose); font-size: 0.8rem; margin-bottom: 0.5rem;">
              Identified ${findings.length} discrepancy record(s):
            </div>
            ${findings.map(d => `
              <div class="discrepancy-item">
                <div style="font-weight: 600; color: var(--accent-rose);">${escapeHtml(d.issueType || 'DISCREPANCY')}</div>
                <div style="font-size: 0.725rem; color: var(--text-muted);">Transaction: ${d.transactionId || 'N/A'} (${d.transactionType || 'general'})</div>
                <div style="margin-top: 0.25rem;">${escapeHtml(d.explanation || JSON.stringify(d.details || {}))}</div>
              </div>
            `).join('')}
          `;
        }
      }
    }
  } catch (err) {
    console.error('Failed to run reconciliation:', err);
  } finally {
    if (manual && btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        Re-Audit Ledger
      `;
    }
  }
}

// Handle Transfer Form
async function handleTransferSubmit(e) {
  if (e) e.preventDefault();
  await executeTransferRequest();
}

async function executeTransferRequest() {
  const srcId = document.getElementById('sourceAccountId').value.trim();
  const dstId = document.getElementById('destinationAccountId').value.trim();
  const amount = document.getElementById('transferAmount').value.trim();
  const desc = document.getElementById('transferDesc').value.trim() || 'Dashboard simulated transfer';
  const idempotencyKey = document.getElementById('idempotencyKey').value.trim();

  const feedbackContainer = document.getElementById('simulatorFeedback');
  const btnSubmit = document.getElementById('btnSubmitTransfer');

  // Client-side quick check
  if (!idempotencyKey) {
    renderFeedbackAlert('error', 'Missing Idempotency-Key', 'Please generate or provide a valid Idempotency-Key header.');
    return;
  }
  if (!srcId || !dstId) {
    renderFeedbackAlert('error', 'Select Accounts', 'Please select both source and destination accounts.');
    return;
  }
  if (srcId === dstId) {
    renderFeedbackAlert('error', 'Invalid Transfer Target', 'Source and destination accounts must be different.');
    return;
  }
  if (!amount || parseFloat(amount) <= 0) {
    renderFeedbackAlert('error', 'Invalid Amount', 'Transfer amount must be a positive number.');
    return;
  }

  // Set loading state
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<span class="spinner"></span> Processing ACID Transfer...';
  }

  try {
    const response = await fetch('/transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        sourceAccountId: srcId,
        destinationAccountId: dstId,
        amount: amount,
        currency: 'INR',
        description: desc,
      }),
    });

    const result = await response.json();

    if (response.status === 201) {
      // Successful new transaction
      renderFeedbackAlert(
        'success',
        'Transfer Executed Successfully (HTTP 201)',
        `
        <div>Transaction ID: <span class="font-mono">${result.data.id}</span></div>
        <div style="margin-top: 0.35rem;">Transferred <strong>₹${result.data.amount} INR</strong> from source to destination.</div>
        <div class="alert-meta">Atomic double-entry ledger postings confirmed in PostgreSQL.</div>
        `
      );
      // Automatically refresh accounts, transactions and reconciliation
      refreshAllData();
    } else if (response.status === 200 && result.replayed === true) {
      // Idempotent replay
      renderFeedbackAlert(
        'info',
        'Idempotent Replay Verified (HTTP 200 OK — replayed: true)',
        `
        <div>Returned original transaction: <span class="font-mono">${result.data.id}</span></div>
        <div style="margin-top: 0.35rem;"><strong>Safety Guarantee:</strong> No duplicate debit or credit was created. Original transaction snapshot returned verbatim.</div>
        <div class="alert-meta">Key: <span class="font-mono">${escapeHtml(idempotencyKey)}</span></div>
        `
      );
    } else if (response.status === 409) {
      // Idempotency payload conflict
      renderFeedbackAlert(
        'warning',
        'Idempotency Key Conflict (HTTP 409 Conflict)',
        `
        <div>${escapeHtml(result.message || 'Key already used with a different request payload.')}</div>
        <div class="alert-meta">The existing key is locked to the previous payload parameters. To send a different transfer, click <strong>"New Key"</strong>.</div>
        `
      );
    } else if (response.status === 422) {
      // Insufficient funds / unprocessable entity
      renderFeedbackAlert(
        'error',
        'Transfer Rejected (HTTP 422 Unprocessable Entity)',
        `
        <div>${escapeHtml(result.message || 'Insufficient funds or unprocessable transaction.')}</div>
        <div class="alert-meta">Transaction was safely aborted without modifying balances or ledger state.</div>
        `
      );
    } else if (response.status === 400) {
      // Validation error
      renderFeedbackAlert(
        'error',
        'Validation Error (HTTP 400 Bad Request)',
        `
        <div>${escapeHtml(result.message || 'Invalid parameters supplied.')}</div>
        <div class="alert-meta">Request failed pre-flight schema validation.</div>
        `
      );
    } else {
      // Generic error (safe without raw stack traces)
      renderFeedbackAlert(
        'error',
        `Error (${response.status})`,
        `<div>${escapeHtml(result.message || 'Transaction could not be processed.')}</div>`
      );
    }
  } catch (err) {
    renderFeedbackAlert(
      'error',
      'Network / Server Communication Error',
      'Unable to connect to LedgerGuard backend. Ensure the server is running on localhost.'
    );
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        Execute Atomic Transfer
      `;
    }
  }
}

function renderFeedbackAlert(type, title, htmlContent) {
  const container = document.getElementById('simulatorFeedback');
  if (!container) return;

  let iconSvg = '';
  let alertClass = 'alert-info';

  if (type === 'success') {
    alertClass = 'alert-success';
    iconSvg = '<svg class="alert-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  } else if (type === 'warning') {
    alertClass = 'alert-warning';
    iconSvg = '<svg class="alert-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
  } else if (type === 'error') {
    alertClass = 'alert-error';
    iconSvg = '<svg class="alert-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  } else {
    alertClass = 'alert-info';
    iconSvg = '<svg class="alert-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  }

  container.innerHTML = `
    <div class="alert ${alertClass}">
      ${iconSvg}
      <div class="alert-content">
        <div class="alert-title">${escapeHtml(title)}</div>
        <div>${htmlContent}</div>
      </div>
    </div>
  `;
}

// Account Ledger Audit Modal
window.viewAccountLedger = async function (accountId) {
  const modal = document.getElementById('ledgerModal');
  const body = document.getElementById('ledgerModalBody');
  const title = document.getElementById('ledgerModalTitle');

  if (!modal || !body) return;

  if (title) title.textContent = `Ledger Entries: ${accountId.substring(0, 8)}...`;
  body.innerHTML = '<div style="text-align: center; padding: 2rem;"><span class="spinner"></span> Loading ledger postings...</div>';
  modal.classList.add('active');

  try {
    const res = await fetch(`/accounts/${accountId}/ledger`);
    const json = await res.json();

    if (json.status === 'success') {
      const entries = json.data.entries || [];
      const curBal = json.data.currentBalance || '0.0000';

      if (entries.length === 0) {
        body.innerHTML = `
          <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No ledger entries found for this account. Current balance: <strong>₹${curBal} INR</strong>.
          </div>
        `;
        return;
      }

      body.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 0.75rem 1rem; background: rgba(255,255,255,0.03); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
          <div>
            <div style="font-size: 0.725rem; color: var(--text-muted);">VERIFIED LEDGER BALANCE</div>
            <div style="font-size: 1.25rem; font-weight: 700; color: #fff;">₹${curBal} INR</div>
          </div>
          <div>
            <span class="badge badge-indigo">${entries.length} Immutable Postings</span>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Entry ID</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(e => `
              <tr>
                <td><span class="uuid-badge font-mono">${e.id.substring(0, 8)}...</span></td>
                <td>
                  <span class="badge ${e.entry_type === 'credit' ? 'badge-emerald' : 'badge-rose'}">
                    ${e.entry_type}
                  </span>
                </td>
                <td class="amount-display ${e.entry_type === 'credit' ? 'amount-positive' : 'amount-negative'}">
                  ${e.entry_type === 'credit' ? '+' : '-'}${formatCurrency(e.amount, 'INR')}
                </td>
                <td style="color: var(--text-muted); font-size: 0.75rem;">${formatDateTime(e.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      body.innerHTML = `<div class="alert alert-error"><div class="alert-content">${escapeHtml(json.message || 'Failed to load ledger')}</div></div>`;
    }
  } catch (err) {
    body.innerHTML = `<div class="alert alert-error"><div class="alert-content">Network error loading ledger entries.</div></div>`;
  }
};

// Utilities
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
