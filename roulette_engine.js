// Roulette Specific Constants
const ROULETTE_NUMBERS = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const VOISINS = [22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25];
const TIERS = [27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33];
const ORPHELINS = [1, 20, 14, 31, 9, 17, 34, 6];

// State
let spinHistory = [];
const MAX_HISTORY = 200;

// DOM
const keypad = document.getElementById('keypad');
const tape = document.getElementById('history-tape');

// Initialize
function init() {
    generateKeypad();
    document.getElementById('btn-undo').addEventListener('click', undoSpin);
    document.getElementById('btn-clear').addEventListener('click', () => { spinHistory = []; updateApp(); });
    document.getElementById('btn-refresh').addEventListener('click', () => location.reload());
    updateApp();
}

function getColorClass(n) {
    if (n === 0) return 'bg-green';
    return RED_NUMBERS.includes(n) ? 'bg-red' : 'bg-black';
}

function getTextColorClass(n) {
    if (n === 0) return 'text-green';
    return RED_NUMBERS.includes(n) ? 'text-red' : 'text-black';
}

function generateKeypad() {
    // 0 is hardcoded, generate 1-36
    let html = '';
    for (let i = 1; i <= 36; i++) {
        html += `<button class="key ${getColorClass(i)}" data-num="${i}">${i}</button>`;
    }
    keypad.insertAdjacentHTML('beforeend', html);
    
    document.querySelectorAll('.key').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const num = parseInt(e.target.getAttribute('data-num'));
            addSpin(num);
        });
    });
}

function addSpin(n) {
    if (spinHistory.length >= MAX_HISTORY) spinHistory.shift();
    spinHistory.push(n);
    updateApp();
}

function undoSpin() {
    if (spinHistory.length > 0) spinHistory.pop();
    updateApp();
}

function updateApp() {
    // 1. Update Tape
    document.getElementById('spin-count').innerText = spinHistory.length;
    tape.innerHTML = '';
    if (spinHistory.length === 0) {
        tape.innerHTML = '<div class="chip-placeholder">Input spins below</div>';
    } else {
        [...spinHistory].reverse().forEach(n => {
            let el = document.createElement('div');
            el.className = `chip ${getColorClass(n)}`;
            el.innerText = n;
            tape.appendChild(el);
        });
    }

    // 2. Perform Analytics
    runAnalytics();
}

function runAnalytics() {
    const len = spinHistory.length;
    
    if (len < 5) {
        document.getElementById('pred-1').innerHTML = '--'; document.getElementById('pred-1').className = 'val';
        document.getElementById('pred-2').innerHTML = '--'; document.getElementById('pred-2').className = 'val';
        document.getElementById('pred-3').innerHTML = '--'; document.getElementById('pred-3').className = 'val';
        document.getElementById('pred-sector').innerHTML = 'Need 5+';
        document.getElementById('pred-dozen').innerHTML = 'Need 5+';
        document.getElementById('pred-outside').innerHTML = 'Need 5+';
        document.getElementById('sleepers-list').innerHTML = 'Data Needed';
        document.getElementById('dealer-sig').innerHTML = 'Analyzing...';
        
        // Reset Bars
        updateBar('red', 'black', 0, 0);
        updateBar('even', 'odd', 0, 0);
        updateBar('low', 'high', 0, 0);
        return;
    }

    // --- MAIN PREDICTIONS (High Accuracy Engine) ---
    let freq = {}, lastSeen = {}, transitions = {};
    let lastNum = spinHistory[spinHistory.length - 1];

    spinHistory.forEach((n, i) => { 
        freq[n] = (freq[n]||0) + 1; 
        lastSeen[n] = i; 
        
        // Markov Transitions: what historically followed the current last number?
        if (i < spinHistory.length - 1) {
            if (n === lastNum) {
                let nextN = spinHistory[i+1];
                transitions[nextN] = (transitions[nextN]||0) + 1;
            }
        }
    });
    
    let scores = [];
    for(let i=0; i<=36; i++) {
        // Base Frequency Score
        let sc = (freq[i]||0) * 1.5;
        
        // Massive Weight on Pattern Repetition (Transitions)
        sc += (transitions[i]||0) * 4.0; 

        // Wheel Geometry Heat Spread (If a number's physical neighbors are hot, it catches heat)
        let idx = ROULETTE_NUMBERS.indexOf(i);
        let leftN = ROULETTE_NUMBERS[(idx - 1 + 37) % 37];
        let rightN = ROULETTE_NUMBERS[(idx + 1) % 37];
        let neighborHeat = ((freq[leftN]||0) + (freq[rightN]||0)) * 0.5;
        sc += neighborHeat;

        // Recency tie-breaker
        sc += (lastSeen[i] !== undefined) ? (lastSeen[i]/1000) : 0; 
        
        scores.push({num: i, score: sc});
    }
    scores.sort((a,b) => b.score - a.score);
    
    // Top 3
    for(let i=1; i<=3; i++) {
        let el = document.getElementById(`pred-${i}`);
        let num = scores[i-1].num;
        el.innerText = num;
        el.className = `val ${getTextColorClass(num)}`;
    }

    // --- SLEEPERS ---
    // Numbers sorted by how long since they appeared (or never appeared)
    let sleepers = [];
    for(let i=0; i<=36; i++) {
        let distance = (lastSeen[i] !== undefined) ? (len - 1 - lastSeen[i]) : len;
        sleepers.push({num: i, dist: distance});
    }
    sleepers.sort((a,b) => b.dist - a.dist);
    let sList = sleepers.slice(0,3).map(s => s.num).join(', ');
    document.getElementById('sleepers-list').innerHTML = `<span class="text-gold">${sList}</span>`;

    // --- DEALER SIGNATURE / WHEEL BIAS ---
    if (len >= 10) {
        let distances = [];
        for(let i=0; i<len-1; i++) {
            let n1 = spinHistory[i], n2 = spinHistory[i+1];
            let idx1 = ROULETTE_NUMBERS.indexOf(n1);
            let idx2 = ROULETTE_NUMBERS.indexOf(n2);
            let dist = idx2 - idx1;
            if(dist < 0) dist += 37;
            distances.push(dist);
        }
        
        // Find most common distance cluster (bin of size 5)
        let maxBinScore = 0; let bestStart = -1;
        for(let start=0; start<=36; start++) {
            let hits = 0;
            distances.forEach(d => {
                // If d is within start + 5 (modulo 37)
                let end = (start+4)%37;
                if(start <= end) { if(d >= start && d <= end) hits++; }
                else { if(d >= start || d <= end) hits++; }
            });
            if(hits > maxBinScore) {
                maxBinScore = hits;
                bestStart = start;
            }
        }
        
        let sigText = "Unclear";
        if(maxBinScore >= Math.max(3, distances.length * 0.2)) {
            let lastSpun = spinHistory[spinHistory.length - 1];
            let lastIdx = ROULETTE_NUMBERS.indexOf(lastSpun);
            let targetNums = [];
            for (let offset = 0; offset <= 4; offset++) {
                let shift = (bestStart + offset) % 37;
                let targetIdx = (lastIdx + shift) % 37;
                targetNums.push(ROULETTE_NUMBERS[targetIdx]);
            }
            sigText = `<span class="text-gold" style="font-size:11px;">${targetNums.join(', ')}</span>`;
        }
        document.getElementById('dealer-sig').innerHTML = sigText;
    }

    // --- PROGRESS BARS (RECENT 30) ---
    let recentSpins = spinHistory.slice(-30);
    let r=0, b=0, e=0, o=0, l=0, h=0, nonZero=0;
    
    recentSpins.forEach(n => {
        if(n === 0) return;
        nonZero++;
        if(RED_NUMBERS.includes(n)) r++; else b++;
        if(n%2===0) e++; else o++;
        if(n<=18) l++; else h++;
    });

    updateBar('red', 'black', r, b, nonZero);
    updateBar('even', 'odd', e, o, nonZero);
    updateBar('low', 'high', l, h, nonZero);

    // --- SECTOR / DOZEN / OUTSIDE TRENDS ---
    updateTrends(recentSpins);
}

function updateBar(id1, id2, count1, count2, total=0) {
    let p1 = 0, p2 = 0;
    if(total > 0) {
        p1 = Math.round((count1/total)*100);
        p2 = Math.round((count2/total)*100);
    }
    document.getElementById(`pct-${id1}`).innerText = `${p1}%`;
    document.getElementById(`pct-${id2}`).innerText = `${p2}%`;
    
    // Set width (if 0 total, leave at 50%)
    let w = total === 0 ? 50 : p1;
    document.getElementById(`bar-${id1}`).style.width = `${w}%`;
}

function updateTrends(spins) {
    if(spins.length < 5) return;
    
    // Sector
    let vHits=0, tHits=0, oHits=0;
    spins.forEach(n => {
        if(VOISINS.includes(n)) vHits++;
        else if(TIERS.includes(n)) tHits++;
        else if(ORPHELINS.includes(n)) oHits++;
    });
    
    let vScore = vHits - (spins.length * (17/37));
    let tScore = tHits - (spins.length * (12/37));
    let oScore = oHits - (spins.length * (8/37));
    
    let maxS = Math.max(vScore, tScore, oScore);
    let sText = "Wait";
    if(maxS > 1.5) {
        if(maxS === vScore) sText = "<span class='text-gold'>Play Zero Area</span>";
        else if(maxS === tScore) sText = "<span class='text-gold'>Play Opp. Zero</span>";
        else sText = "<span class='text-gold'>Play Sides</span>";
    }
    document.getElementById('pred-sector').innerHTML = sText;

    // Dozens
    let d1=0, d2=0, d3=0;
    spins.forEach(n => {
        if(n>=1 && n<=12) d1++; else if(n>=13 && n<=24) d2++; else if(n>=25) d3++;
    });
    let dMax = Math.max(d1,d2,d3);
    let dText = "Wait";
    if(dMax > spins.length*(12/37) + 2.5) { // Stricter threshold for High Accuracy
        if(dMax===d1) dText = "<span class='text-gold'>Play 1 to 12</span>";
        else if(dMax===d2) dText = "<span class='text-gold'>Play 13 to 24</span>";
        else if(dMax===d3) dText = "<span class='text-gold'>Play 25 to 36</span>";
    }
    document.getElementById('pred-dozen').innerHTML = dText;

    // Outside (Finding best trend)
    let r=0, b=0, e=0, o=0, l=0, h=0;
    spins.forEach(n => {
        if(n===0)return;
        if(RED_NUMBERS.includes(n)) r++; else b++;
        if(n%2===0) e++; else o++;
        if(n<=18) l++; else h++;
    });
    
    let oMax = Math.max(r,b,e,o,l,h);
    let oText = "Wait";
    // > 60% win rate required to call it a strong trend to increase accuracy
    if(oMax > spins.length*(18/37) + 3.0) {
        if(oMax===r) oText = "<span class='text-red'>Play RED</span>";
        else if(oMax===b) oText = "Play BLACK";
        else if(oMax===e) oText = "<span class='text-gold'>Play EVEN</span>";
        else if(oMax===o) oText = "<span class='text-gold'>Play ODD</span>";
        else if(oMax===l) oText = "<span class='text-gold'>Play 1-18 (Low)</span>";
        else if(oMax===h) oText = "<span class='text-gold'>Play 19-36 (High)</span>";
    }
    document.getElementById('pred-outside').innerHTML = oText;
}

// Boot
init();
