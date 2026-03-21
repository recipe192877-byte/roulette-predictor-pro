// Roulette Specific Constants
const ROULETTE_NUMBERS = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const VOISINS = [22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25];
const TIERS = [27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33];
const ORPHELINS = [1, 20, 14, 31, 9, 17, 34, 6];

// State
let spinHistory = [];
const MAX_HISTORY = 200;
let isAggressive = false;
const BASE_UNIT = 10;

// DOM
const keypad = document.getElementById('keypad');
const tape = document.getElementById('history-tape');

// Initialize
function init() {
    generateKeypad();
    document.getElementById('btn-undo').addEventListener('click', undoSpin);
    document.getElementById('btn-clear').addEventListener('click', () => { spinHistory = []; updateApp(); });
    document.getElementById('btn-refresh').addEventListener('click', () => location.reload());
    
    // Risk Toggle
    document.getElementById('risk-toggle').addEventListener('click', () => {
        isAggressive = !isAggressive;
        document.getElementById('risk-track').classList.toggle('active', isAggressive);
        let lbl = document.getElementById('risk-label');
        lbl.innerText = isAggressive ? 'AGGR' : 'CONS';
        lbl.classList.toggle('active', isAggressive);
        updateApp();
    });

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
        [...spinHistory].reverse().forEach((n, idx) => {
            let el = document.createElement('div');
            el.className = `chip ${getColorClass(n)} ${idx === 0 ? 'newest' : ''}`;
            el.innerText = n;
            tape.appendChild(el);
        });
    }

    // 2. Perform Analytics & Calculate Progession up to Current
    runAnalyticsAndBetting();
}

function resetUI() {
    [1,2,3].forEach(i => {
        document.getElementById(`pred-${i}`).innerHTML = '--'; 
        document.getElementById(`pred-${i}`).className = 'val';
        document.getElementById(`bet-${i}`).innerHTML = 'Wait';
        document.getElementById(`bet-${i}`).className = 'bet-amt';
        document.getElementById(`box-pred-${i}`).classList.remove('active-bet');
    });
    
    ['sector', 'dozen', 'outside'].forEach(id => {
        document.getElementById(`pred-${id}`).innerHTML = 'Need 5+';
        document.getElementById(`bet-${id}`).innerHTML = '--';
        document.getElementById(`bet-${id}`).className = 'bet-amt mt-5';
        document.getElementById(`box-${id}`).classList.remove('active-bet');
    });

    document.getElementById('streak-alert').innerHTML = 'None';
    document.getElementById('dealer-sig').innerHTML = 'Analyzing...';
    
    updateBar('red', 'black', 0, 0);
    updateBar('d1', 'd2', 0, 0, 0);
    document.getElementById('bar-d3').style.width = '33.3%';
}

// Check if a number satisfies a prediction category
function satisfiesPrediction(n, pred) {
    if(!pred || pred === 'Wait') return false;
    if(pred.includes('Zero') && VOISINS.includes(n)) return true;
    if(pred.includes('Opp.') && TIERS.includes(n)) return true;
    if(pred.includes('Sides') && ORPHELINS.includes(n)) return true;
    if(pred.includes('1 to 12') && n>=1 && n<=12) return true;
    if(pred.includes('13 to 24') && n>=13 && n<=24) return true;
    if(pred.includes('25 to 36') && n>=25 && n<=36) return true;
    if(pred.includes('RED') && RED_NUMBERS.includes(n)) return true;
    if(pred.includes('BLACK') && !RED_NUMBERS.includes(n) && n!==0) return true;
    if(pred.includes('EVEN') && n%2===0 && n!==0) return true;
    if(pred.includes('ODD') && n%2!==0 && n!==0) return true;
    if(pred.includes('Low') && n>=1 && n<=18) return true;
    if(pred.includes('High') && n>=19 && n<=36) return true;
    return false;
}

// Returns { sectorText, dozenText, outsideText } for a given slice of history
function getPredictionsForHistory(historySlice) {
    if(historySlice.length < 5) return { sec: 'Wait', doz: 'Wait', out: 'Wait' };
    
    // Constants for Thresholds based on Mode
    // Conservative requires stronger trends, Aggressive tries to jump on early trends
    const thresholdMult = isAggressive ? 0.7 : 1.3;
    
    // Sector
    let vHits=0, tHits=0, oHits=0;
    historySlice.forEach(n => {
        if(VOISINS.includes(n)) vHits++;
        else if(TIERS.includes(n)) tHits++;
        else if(ORPHELINS.includes(n)) oHits++;
    });
    let vDiff = vHits - (historySlice.length * (17/37));
    let tDiff = tHits - (historySlice.length * (12/37));
    let oDiff = oHits - (historySlice.length * (8/37));
    let maxS = Math.max(vDiff, tDiff, oDiff);
    let sText = "Wait";
    if(maxS > (1.5 * thresholdMult)) {
        if(maxS === vDiff) sText = "<span class='text-gold'>Play Zero Area</span>";
        else if(maxS === tDiff) sText = "<span class='text-gold'>Play Opp. Zero</span>";
        else sText = "<span class='text-gold'>Play Sides</span>";
    }

    // Dozens
    let d1=0, d2=0, d3=0;
    historySlice.forEach(n => {
        if(n>=1 && n<=12) d1++; else if(n>=13 && n<=24) d2++; else if(n>=25 && n<=36) d3++;
    });
    let dMax = Math.max(d1,d2,d3);
    let dText = "Wait";
    if(dMax > historySlice.length*(12/37) + (2.5 * thresholdMult)) { 
        if(dMax===d1) dText = "<span class='text-blue'>Play 1 to 12</span>";
        else if(dMax===d2) dText = "<span class='text-gold'>Play 13 to 24</span>";
        else if(dMax===d3) dText = "<span class='text-green'>Play 25 to 36</span>";
    }

    // Outside
    let r=0, b=0, e=0, o=0, l=0, h=0;
    historySlice.forEach(n => {
        if(n===0)return;
        if(RED_NUMBERS.includes(n)) r++; else b++;
        if(n%2===0) e++; else o++;
        if(n<=18) l++; else h++;
    });
    let oMax = Math.max(r,b,e,o,l,h);
    let oText = "Wait";
    if(oMax > historySlice.length*(18/37) + (3.0 * thresholdMult)) {
        if(oMax===r) oText = "<span class='text-red'>Play RED</span>";
        else if(oMax===b) oText = "Play BLACK";
        else if(oMax===e) oText = "<span class='text-gold'>Play EVEN</span>";
        else if(oMax===o) oText = "<span class='text-gold'>Play ODD</span>";
        else if(oMax===l) oText = "<span class='text-blue'>Play 1-18 (Low)</span>";
        else if(oMax===h) oText = "<span class='text-green'>Play 19-36 (High)</span>";
    }

    return { sec: sText, doz: dText, out: oText };
}


function runAnalyticsAndBetting() {
    const len = spinHistory.length;
    if (len < 5) {
        resetUI();
        return;
    }

    // --- 1. Calculate Betting Progression from History ---
    // Martingale progression strictly tracked based on "what we would have predicted" vs "what actually hit"
    let prog = { sector: 0, dozen: 0, outside: 0 };
    
    for(let i = 5; i < spinHistory.length; i++) {
        let historyAtThatPoint = spinHistory.slice(0, i);
        let preds = getPredictionsForHistory(historyAtThatPoint);
        let actualHit = spinHistory[i];
        
        // Sector evaluation
        if(preds.sec !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.sec)) prog.sector = 0; // Win, reset
            else prog.sector = Math.min(prog.sector + 1, 5); // Lose, increase step (max 5)
        }
        
        // Dozen eval
        if(preds.doz !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.doz)) prog.dozen = 0;
            else prog.dozen = Math.min(prog.dozen + 1, 5);
        }

        // Outside eval
        if(preds.out !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.out)) prog.outside = 0;
            else prog.outside = Math.min(prog.outside + 1, 6); // Max 6 steps on 50/50
        }
    }

    // --- 2. Calculate CURRENT Predictions ---
    let currentPreds = getPredictionsForHistory(spinHistory);
    
    // Apply UI for Areas & Trends
    let areas = [
        { id: 'sector', html: currentPreds.sec, p: prog.sector, mult: 2.0 }, // Voisins ~50%, so mostly double.
        { id: 'dozen', html: currentPreds.doz, p: prog.dozen, mult: 1.5 }, // Dozens pay 2:1, so we can use a softer progression
        { id: 'outside', html: currentPreds.out, p: prog.outside, mult: 2.0 } // Even money
    ];

    areas.forEach(ar => {
        document.getElementById(`pred-${ar.id}`).innerHTML = ar.html;
        let box = document.getElementById(`box-${ar.id}`);
        let betEl = document.getElementById(`bet-${ar.id}`);
        
        if(ar.html !== 'Wait') {
            // Calculate Exact Bet Amount
            // Progression 0 = 10, Prog 1 = 20, Prog 2 = 40 (If mult is 2)
            // If Dozen (mult=1.5), then 10 -> 15 -> 23 -> 35
            let bet = Math.ceil(BASE_UNIT * Math.pow(ar.mult, ar.p));
            // Round to nearest 5 for clean numbers
            if(bet > 10) bet = Math.round(bet/5)*5;
            
            betEl.innerHTML = `Bet ${bet} Pts`;
            betEl.className = 'bet-amt hot mt-5';
            box.classList.add('active-bet');
        } else {
            betEl.innerHTML = '--';
            betEl.className = 'bet-amt mt-5';
            box.classList.remove('active-bet');
        }
    });


    // --- 3. High Accuracy Engine for Single Numbers ---
    let freq = {}, lastSeen = {}, transitions = {};
    let lastNum = spinHistory[spinHistory.length - 1];

    spinHistory.forEach((n, i) => { 
        freq[n] = (freq[n]||0) + 1; 
        lastSeen[n] = i; 
        if(i < spinHistory.length - 1) {
            if(n === lastNum) {
                let nextN = spinHistory[i+1];
                transitions[nextN] = (transitions[nextN]||0) + 1;
            }
        }
    });
    
    let scores = [];
    for(let i=0; i<=36; i++) {
        let sc = (freq[i]||0) * 1.5;
        sc += (transitions[i]||0) * 4.0; 
        let idx = ROULETTE_NUMBERS.indexOf(i);
        let leftN = ROULETTE_NUMBERS[(idx - 1 + 37) % 37];
        let rightN = ROULETTE_NUMBERS[(idx + 1) % 37];
        sc += ((freq[leftN]||0) + (freq[rightN]||0)) * 0.5;
        sc += (lastSeen[i] !== undefined) ? (lastSeen[i]/1000) : 0; 
        scores.push({num: i, score: sc});
    }
    scores.sort((a,b) => b.score - a.score);
    
    // Top 3 updates
    for(let i=1; i<=3; i++) {
        let el = document.getElementById(`pred-${i}`);
        let num = scores[i-1].num;
        let scoreVal = scores[i-1].score;
        
        el.innerText = num;
        el.className = `val ${getTextColorClass(num)}`;
        
        let box = document.getElementById(`box-pred-${i}`);
        let betEl = document.getElementById(`bet-${i}`);
        
        // If the score is strong enough, suggest betting BASE_UNIT flat
        let thresh = isAggressive ? 1.5 : 2.5; 
        if(scoreVal > thresh) {
            betEl.innerHTML = `Bet ${BASE_UNIT} Pts`;
            betEl.className = 'bet-amt hot';
            box.classList.add('active-bet');
        } else {
            betEl.innerHTML = 'Wait';
            betEl.className = 'bet-amt';
            box.classList.remove('active-bet');
        }
    }

    // --- 4. Streaks & Standard Deviation Tracker ---
    let recents = spinHistory.slice(-15);
    let stText = "None";
    if(recents.length >= 7) {
        let bCount=0, rCount=0, eCount=0, oCount=0;
        let last7 = recents.slice(-7);
        last7.forEach(n => {
            if(n!==0){
                if(RED_NUMBERS.includes(n)) rCount++; else bCount++;
                if(n%2===0) eCount++; else oCount++;
            }
        });
        
        // Z-score logic approximated: 6 or 7 of same type in last 7 is abnormal
        if(rCount >= 6) stText = "<span class='text-red'>Red Overbought (Revert soon)</span>";
        else if(bCount >= 6) stText = "Black Overbought (Revert soon)";
        else if(eCount >= 6) stText = "<span class='text-gold'>Even Overbought</span>";
        else if(oCount >= 6) stText = "<span class='text-gold'>Odd Overbought</span>";
    }
    document.getElementById('streak-alert').innerHTML = stText;

    // --- 5. Dealer Signature ---
    if (len >= 10) {
        let distances = [];
        for(let i=0; i<len-1; i++) {
            let dist = ROULETTE_NUMBERS.indexOf(spinHistory[i+1]) - ROULETTE_NUMBERS.indexOf(spinHistory[i]);
            if(dist < 0) dist += 37;
            distances.push(dist);
        }
        let maxHits = 0; let bestStart = -1;
        for(let start=0; start<=36; start++) {
            let hits = distances.filter(d => {
                let end = (start+4)%37;
                return start<=end ? (d>=start && d<=end) : (d>=start || d<=end);
            }).length;
            if(hits > maxHits) { maxHits = hits; bestStart = start; }
        }
        let sigText = "Unclear";
        if(maxHits >= Math.max(3, distances.length * 0.2)) {
            let lIdx = ROULETTE_NUMBERS.indexOf(spinHistory[spinHistory.length - 1]);
            let tNums = [0,1,2,3,4].map(off => ROULETTE_NUMBERS[(lIdx + (bestStart+off)%37)%37]);
            sigText = `<span class="text-gold" style="font-size:11px;">Track: ${tNums.join(',')}</span>`;
        }
        document.getElementById('dealer-sig').innerHTML = sigText;
    }

    // --- 6. Progress Bars (Recent 30) ---
    let recentSpins = spinHistory.slice(-30);
    let r=0, b=0, d1=0, d2=0, d3=0, nonZero=0;
    
    recentSpins.forEach(n => {
        if(n === 0) return;
        nonZero++;
        if(RED_NUMBERS.includes(n)) r++; else b++;
        if(n>=1 && n<=12) d1++; else if(n>=13 && n<=24) d2++; else if(n>=25 && n<=36) d3++;
    });

    updateBar('red', 'black', r, b, nonZero);
    
    // Dozens 3-way bar
    if(nonZero > 0) {
        let pd1 = Math.round((d1/nonZero)*100);
        let pd2 = Math.round((d2/nonZero)*100);
        document.getElementById('pct-d1').innerText = `${pd1}%`;
        document.getElementById('pct-d2').innerText = `${pd2}%`;
        document.getElementById('pct-d3').innerText = `${100-pd1-pd2}%`;
        
        document.getElementById('bar-d1').style.width = `${pd1}%`;
        document.getElementById('bar-d2').style.width = `${pd2}%`;
        document.getElementById('bar-d3').style.width = `${100-pd1-pd2}%`;
    }
}

function updateBar(id1, id2, count1, count2, total=0) {
    let p1 = 0, p2 = 0;
    if(total > 0) {
        p1 = Math.round((count1/total)*100);
        p2 = Math.round((count2/total)*100);
    }
    document.getElementById(`pct-${id1}`).innerText = `${p1}%`;
    document.getElementById(`pct-${id2}`).innerText = `${p2}%`;
    let w = total === 0 ? 50 : p1;
    document.getElementById(`bar-${id1}`).style.width = `${w}%`;
}

// Boot
init();
