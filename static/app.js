// ===== Image resize via Canvas =====
function resizeImage(file, maxSide = 1568, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        if (width >= height) { height = Math.round(height * maxSide / width); width = maxSide; }
        else { width = Math.round(width * maxSide / height); height = maxSide; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }, 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ===== File handling =====
const analyzeBtn = document.getElementById('analyzeBtn');
const chosen = { fridge: null, lunchbox: null };

[
  ['fridgeLibrary',   'fridge'],
  ['fridgeCamera',    'fridge'],
  ['lunchboxLibrary', 'lunchbox'],
  ['lunchboxCamera',  'lunchbox'],
].forEach(([id, type]) => {
  document.getElementById(id).addEventListener('change', e => {
    if (e.target.files[0]) handleFile(type, e.target.files[0]);
    e.target.value = '';
  });
});

document.getElementById('fridgePickLibrary').addEventListener('click',   () => document.getElementById('fridgeLibrary').click());
document.getElementById('fridgePickCamera').addEventListener('click',    () => document.getElementById('fridgeCamera').click());
document.getElementById('lunchboxPickLibrary').addEventListener('click', () => document.getElementById('lunchboxLibrary').click());
document.getElementById('lunchboxPickCamera').addEventListener('click',  () => document.getElementById('lunchboxCamera').click());
document.getElementById('fridgeRemoveBtn').addEventListener('click',   () => removeImage('fridge'));
document.getElementById('lunchboxRemoveBtn').addEventListener('click', () => removeImage('lunchbox'));

['fridgeZone', 'lunchboxZone'].forEach(zoneId => {
  const zone = document.getElementById(zoneId);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(zoneId === 'fridgeZone' ? 'fridge' : 'lunchbox', file);
  });
});

function handleFile(type, file) {
  if (!file.type.startsWith('image/')) { showError('Please select an image file.'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById(type === 'fridge' ? 'fridgeImg' : 'lunchboxImg').src = ev.target.result;
    document.getElementById(type === 'fridge' ? 'fridgeZone' : 'lunchboxZone').hidden = true;
    document.getElementById(type === 'fridge' ? 'fridgePreview' : 'lunchboxPreview').hidden = false;
    chosen[type] = file;
    updateBtn();
  };
  reader.readAsDataURL(file);
}

function removeImage(type) {
  chosen[type] = null;
  document.getElementById(type === 'fridge' ? 'fridgeZone' : 'lunchboxZone').hidden = false;
  document.getElementById(type === 'fridge' ? 'fridgePreview' : 'lunchboxPreview').hidden = true;
  updateBtn();
}

function updateBtn() {
  analyzeBtn.disabled = !(chosen.fridge && chosen.lunchbox);
}

// ===== Location =====
let detectedCountry = '';
const countrySelect = document.getElementById('countrySelect');
countrySelect.addEventListener('change', () => {
  if (countrySelect.value) { detectedCountry = countrySelect.value; showCountryBadge(countrySelect.value, '🌍'); }
  else clearCountry();
});

document.getElementById('locateBtn').addEventListener('click', detectLocation);
document.getElementById('clearCountryBtn').addEventListener('click', clearCountry);

function detectLocation() {
  if (!navigator.geolocation) { showError('Geolocation not supported. Choose a country manually.'); return; }
  const btn = document.getElementById('locateBtn');
  document.getElementById('locateIcon').textContent = '⏳';
  document.getElementById('locateText').textContent = 'Detecting…';
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const { latitude, longitude } = pos.coords;
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`, { headers: { 'Accept-Language': 'en' } });
      const geo = await res.json();
      const country = geo.address?.country || '';
      if (country) { detectedCountry = country; countrySelect.value = ''; showCountryBadge(country, '📍'); }
      else showError('Could not determine your country. Choose one manually.');
    } catch { showError('Location lookup failed. Choose a country manually.'); }
    finally { resetLocateBtn(); }
  }, err => {
    const msgs = { 1: 'Location permission denied.', 2: 'Location unavailable.', 3: 'Location timed out.' };
    showError(msgs[err.code] || 'Could not get location.');
    resetLocateBtn();
  }, { timeout: 10000 });
}

function resetLocateBtn() {
  document.getElementById('locateIcon').textContent = '📍';
  document.getElementById('locateText').textContent = 'Use my location';
  document.getElementById('locateBtn').disabled = false;
}

function showCountryBadge(country, icon) {
  document.getElementById('countryBadgeText').textContent = `${icon} ${country}`;
  document.getElementById('countryBadge').hidden = false;
}

function clearCountry() {
  detectedCountry = '';
  countrySelect.value = '';
  document.getElementById('countryBadge').hidden = true;
}

// ===== Form submit =====
document.getElementById('analyzeForm').addEventListener('submit', async e => {
  e.preventDefault();
  dismissError();
  showLoading();
  animateSteps();

  try {
    const [fridgeB64, lunchboxB64] = await Promise.all([
      resizeImage(chosen.fridge),
      resizeImage(chosen.lunchbox),
    ]);

    const country   = detectedCountry || countrySelect.value || '';
    const allergies = document.getElementById('allergies').value;
    const likes     = document.getElementById('likes').value;
    const dislikes  = document.getElementById('dislikes').value;
    const brands    = document.getElementById('brands').value;

    const res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fridgeB64, lunchboxB64, country, allergies, likes, dislikes, brands }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Something went wrong. Please try again.');
      hideLoading(); return;
    }

    renderResults(data.data);

  } catch {
    showError('Something went wrong. Please check your connection and try again.');
    hideLoading();
  }
});

// ===== Loading =====
function animateSteps() {
  ['step1','step2','step3','step4'].forEach((id, i) => {
    setTimeout(() => document.getElementById(id).classList.add('active'), i * 1800);
  });
}

function showLoading() {
  document.getElementById('uploadSection').hidden = true;
  document.getElementById('loadingSection').hidden = false;
  document.getElementById('resultsSection').hidden = true;
}

function hideLoading() {
  document.getElementById('uploadSection').hidden = false;
  document.getElementById('loadingSection').hidden = true;
  ['step1','step2','step3','step4'].forEach(id => document.getElementById(id).classList.remove('active'));
}

// ===== Results =====
function renderResults(data) {
  document.getElementById('loadingSection').hidden = true;
  document.getElementById('resultsSection').hidden = false;

  const allergies = document.getElementById('allergies').value.trim();
  const likes     = document.getElementById('likes').value.trim();
  const dislikes  = document.getElementById('dislikes').value.trim();

  let prefsHtml = '';
  if (allergies || likes || dislikes) {
    prefsHtml = `<div class="info-card info-card-prefs"><div class="info-icon">🙋</div><div class="info-body"><strong>Your Preferences Applied</strong>${allergies ? `<p><span class="pref-tag pref-tag-allergy">⚠️ Allergies</span> ${allergies}</p>` : ''}${likes ? `<p><span class="pref-tag pref-tag-like">💚 Likes</span> ${likes}</p>` : ''}${dislikes ? `<p><span class="pref-tag pref-tag-dislike">🚫 Dislikes</span> ${dislikes}</p>` : ''}</div></div>`;
  }

  const countryUsed = detectedCountry || countrySelect.value || '';
  const countryHtml = countryUsed ? `<div class="info-card"><div class="info-icon">🌍</div><div class="info-body"><strong>Cuisine Style</strong><p>${countryUsed} — regional flavours applied</p></div></div>` : '';

  document.getElementById('infoCards').innerHTML = `
    <div class="info-card"><div class="info-icon">🧊</div><div class="info-body"><strong>Detected Ingredients</strong><p>${data.fridge_ingredients.join(', ')}</p></div></div>
    <div class="info-card"><div class="info-icon">🍱</div><div class="info-body"><strong>Lunchbox Capacity</strong><p>${data.lunchbox_capacity}</p></div></div>
    ${countryHtml}${prefsHtml}`;

  const mealsGrid = document.getElementById('mealsGrid');
  mealsGrid.innerHTML = data.meals.map((meal, i) => `
    <div class="meal-card">
      <div class="meal-number">${i + 1}</div>
      <h3 class="meal-name">${meal.name}</h3>
      <p class="meal-desc">${meal.description}</p>
      <div class="meal-meta">
        <span class="badge badge-time">⏱ ${meal.prep_time}</span>
        <span class="badge badge-fit">${meal.fits_lunchbox ? '✅ Fits lunchbox' : '⚠️ May be tight'}</span>
        <span class="badge badge-cal">🔥 ${meal.nutrition.calories}</span>
      </div>
      <div class="nutrition-grid">
        <div class="nut-cell nut-protein"><div class="nut-icon">💪</div><div class="nut-label">Protein</div><div class="nut-val">${meal.nutrition.protein}</div></div>
        <div class="nut-cell nut-carbs"><div class="nut-icon">🌾</div><div class="nut-label">Carbs</div><div class="nut-val">${meal.nutrition.carbs}</div></div>
        <div class="nut-cell nut-fat"><div class="nut-icon">🥑</div><div class="nut-label">Healthy Fat</div><div class="nut-val">${meal.nutrition.fat}</div></div>
      </div>
      <details class="ingredients-detail">
        <summary>🛒 Ingredients (${meal.ingredients.length})</summary>
        <ul>${meal.ingredients.map(ing => `<li>${ing}</li>`).join('')}</ul>
      </details>
      <details class="assembly-detail">
        <summary>📋 How to assemble</summary>
        <p>${meal.assembly}</p>
      </details>
    </div>`).join('');

  // Set animation delays via JS property (not inline style attribute)
  Array.from(mealsGrid.querySelectorAll('.meal-card')).forEach((card, i) => {
    card.style.animationDelay = `${i * 0.15}s`;
  });

  if (data.tips && data.tips.length) {
    document.getElementById('tipsSection').hidden = false;
    document.getElementById('tipsList').innerHTML = data.tips.map(t => `<li>${t}</li>`).join('');
  }
}

document.getElementById('resetBtn').addEventListener('click', resetApp);

function resetApp() {
  document.getElementById('resultsSection').hidden = true;
  document.getElementById('uploadSection').hidden = false;
  removeImage('fridge');
  removeImage('lunchbox');
  document.getElementById('tipsSection').hidden = true;
  ['step1','step2','step3','step4'].forEach(id => document.getElementById(id).classList.remove('active'));
}

document.getElementById('dismissErrorBtn').addEventListener('click', dismissError);

function showError(msg) {
  document.getElementById('errorText').textContent = msg;
  document.getElementById('errorBanner').hidden = false;
}

function dismissError() {
  document.getElementById('errorBanner').hidden = true;
}
