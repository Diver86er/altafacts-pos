// The spreadsheet parser is only needed for XLS/XLSX imports. Keep it off the
  // startup path so normal POS launches do not wait for this large dependency.
  window.loadSpreadsheetLibrary = (() => {
    let pending;
    return () => {
      if (window.XLSX) return Promise.resolve(window.XLSX);
      if (pending) return pending;
      pending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        script.onload = () => resolve(window.XLSX);
        script.onerror = () => { pending = null; reject(new Error('Spreadsheet reader failed to load')); };
        document.head.appendChild(script);
      });
      return pending;
    };
  })();
  document.addEventListener('change', async event => {
    const input = event.target;
    const file = input?.id === 'client-list-upload' && input.files?.[0];
    if (!file || window.XLSX || input.dataset.xlsxLoadFailed || !/\.xlsx?$/i.test(file.name)) return;
    event.stopImmediatePropagation();
    try {
      await window.loadSpreadsheetLibrary();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      console.error(error);
      input.dataset.xlsxLoadFailed = '1';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      delete input.dataset.xlsxLoadFailed;
    }
  }, true);
