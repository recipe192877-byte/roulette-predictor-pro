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
let progMode = 'MART'; // MART, FIBO, DALE
let serverIP = localStorage.getItem('rppro_server_ip') || 'localhost';
const BASE_UNIT = 10;
const MAX_BET = 500;
const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
let isVoiceEnabled = false;
let pnlChartInstance = null;

// Voice API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

// DOM
const keypad = document.getElementById('keypad');
const tape = document.getElementById('history-tape');

// Initialize
function init() {
    loadState();
    generateKeypad();
    
    // Set Risk Toggle Initial State
    document.getElementById('risk-track').classList.toggle('active', isAggressive);
    let lbl = document.getElementById('risk-label');
    lbl.innerText = isAggressive ? 'AGGR' : 'CONS';
    lbl.classList.toggle('active', isAggressive);

    document.getElementById('btn-undo').addEventListener('click', undoSpin);
    document.getElementById('btn-clear').addEventListener('click', () => { 
        if(confirm("Clear all history?")) { spinHistory = []; updateApp(); }
    });
    document.getElementById('btn-refresh').addEventListener('click', () => location.reload());
    
    // Server Config
    document.getElementById('server-status').addEventListener('click', () => {
        let ip = prompt("Enter Server IP (e.g. 192.168.1.5) or 'localhost':", serverIP);
        if(ip && ip.trim() !== "") {
            serverIP = ip.trim();
            localStorage.setItem('rppro_server_ip', serverIP);
            updateServerStatus('Connecting...', '');
            fetchMLUpdate();
        }
    });

    // Risk Toggle Logic
    document.getElementById('risk-toggle').addEventListener('click', () => {
        isAggressive = !isAggressive;
        document.getElementById('risk-track').classList.toggle('active', isAggressive);
        lbl.innerText = isAggressive ? 'AGGR' : 'CONS';
        lbl.classList.toggle('active', isAggressive);
        updateApp();
    });

    // Progression Toggle Logic
    updateProgUI();

    document.getElementById('prog-toggle').addEventListener('click', () => {
        if(progMode === 'MART') progMode = 'FIBO';
        else if(progMode === 'FIBO') progMode = 'DALE';
        else progMode = 'MART';
        updateProgUI();
        updateApp();
    });
}

function updateProgUI() {
    let progLbl = document.getElementById('prog-label');
    let track = document.getElementById('prog-track');
    progLbl.innerText = progMode;
    if(progMode === 'MART') { track.classList.remove('active'); progLbl.classList.remove('active'); track.style.borderColor=''; }
    else if(progMode === 'FIBO') { track.classList.add('active'); progLbl.classList.add('active'); track.style.borderColor=''; }
    else { track.classList.add('active'); progLbl.classList.remove('active'); track.style.borderColor='#69f0ae'; }
}

function updateServerStatus(text, statusItem) {
    document.getElementById('status-text').innerText = text;
    let dot = document.getElementById('status-dot');
    if(dot) dot.className = 'status-dot ' + statusItem;
}

function getBetAmount(progSteps, mult, type) {
    let amt = 0;
    if(progMode === 'FIBO') {
        amt = BASE_UNIT * FIB[Math.min(progSteps, FIB.length - 1)];
    } else if(progMode === 'DALE') {
        amt = BASE_UNIT + (progSteps * (BASE_UNIT / 2)); 
    } else { // MART
        if(type === 'math') {
            amt = Math.ceil(BASE_UNIT * Math.pow(mult, Math.min(progSteps, 5))); // Limit to 5 steps
            if(amt > 10) amt = Math.round(amt/5)*5;
        } else {
            amt = BASE_UNIT * (Math.min(progSteps, 5) + 1);
        }
    }
    return Math.min(amt, MAX_BET);


    initVoice();
    updateApp();
}

function loadState() {
    try {
        let savedHist = localStorage.getItem('rppro_history');
        if(savedHist) {
            spinHistory = JSON.parse(savedHist);
            if(spinHistory.length > MAX_HISTORY) spinHistory = spinHistory.slice(-MAX_HISTORY);
        }
        let savedRisk = localStorage.getItem('rppro_risk');
        if(savedRisk !== null) isAggressive = (savedRisk === 'true');
        
        let savedProg = localStorage.getItem('rppro_prog_mode');
        if(savedProg !== null) progMode = savedProg;
    } catch(e) { console.error("Could not load state", e); }
}

function saveState() {
    try {
        localStorage.setItem('rppro_history', JSON.stringify(spinHistory));
        localStorage.setItem('rppro_risk', isAggressive);
        localStorage.setItem('rppro_prog_mode', progMode);
    } catch(e) { console.error("Could not save state", e); }
}

function initVoice() {
    let btn = document.getElementById('btn-voice');
    if(!SpeechRecognition) {
        btn.style.display = 'none';
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    const wordsMap = {"zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10, "eleven":11, "twelve":12, "thirteen":13, "fourteen":14,"fifteen":15,"sixteen":16,"seventeen":17,"eighteen":18,"nineteen":19,"twenty":20,"thirty":30};

    recognition.onresult = function(event) {
        let lastResult = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        let numMatch = lastResult.match(/\b([0-9]|[1-2][0-9]|3[0-6])\b/);
        
        let foundNum = -1;
        if(numMatch) {
            foundNum = parseInt(numMatch[1], 10);
        } else {
            for(let word in wordsMap) {
                if(lastResult.includes(word)) { foundNum = wordsMap[word]; break; }
            }
        }
        
        if(foundNum >= 0 && foundNum <= 36) {
            speakText(`Added ${foundNum}`);
            addSpin(foundNum);
        }
    };
    
    recognition.onend = function() {
        if(isVoiceEnabled) recognition.start(); // auto-restart if enabled
    };

    btn.addEventListener('click', () => {
        isVoiceEnabled = !isVoiceEnabled;
        if(isVoiceEnabled) {
            btn.innerHTML = '🎤 ON';
            btn.classList.add('active');
            recognition.start();
            speakText("Voice mode activated");
        } else {
            btn.innerHTML = '🎤 OFF';
            btn.classList.remove('active');
            recognition.stop();
        }
    });
}

function speakText(text) {
    if(!isVoiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    let utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
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
    saveState();

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
    
    ['column', 'dozen', 'outside', 'voisins', 'tiers', 'orphelins'].forEach(id => {
        let pEl = document.getElementById(`pred-${id}`);
        let bEl = document.getElementById(`bet-${id}`);
        let bxEl = document.getElementById(`box-${id}`);
        if(pEl) pEl.innerHTML = 'Need 5+';
        if(bEl) {
            bEl.innerHTML = '--';
            bEl.className = 'bet-amt mt-5';
        }
        if(bxEl) bxEl.classList.remove('active-bet');
    });

    document.getElementById('streak-alert').innerHTML = 'None';
    document.getElementById('dealer-sig').innerHTML = 'Analyzing...';
    
    updateBar('red', 'black', 0, 0);
    updateBar('d1', 'd2', 0, 0, 0);
    document.getElementById('bar-d3').style.width = '33.3%';

    renderChart([0]);
    let balEl = document.getElementById('balance-display');
    balEl.innerText = `0 Pts`;
    balEl.style.color = '#888';
}

function satisfiesPrediction(n, pred) {
    if(!pred || pred === 'Wait') return false;
    let plainPred = pred.replace(/<[^>]*>?/gm, ''); 
    if(plainPred.includes('Col 1') && n!==0 && n%3===1) return true;
    if(plainPred.includes('Col 2') && n!==0 && n%3===2) return true;
    if(plainPred.includes('Col 3') && n!==0 && n%3===0) return true;
    if(plainPred.includes('1 to 12') && n>=1 && n<=12) return true;
    if(plainPred.includes('13 to 24') && n>=13 && n<=24) return true;
    if(plainPred.includes('25 to 36') && n>=25 && n<=36) return true;
    if(plainPred.includes('RED') && RED_NUMBERS.includes(n)) return true;
    if(plainPred.includes('BLACK') && !RED_NUMBERS.includes(n) && n!==0) return true;
    if(plainPred.includes('EVEN') && n%2===0 && n!==0) return true;
    if(plainPred.includes('ODD') && n%2!==0 && n!==0) return true;
    if(plainPred.includes('Low') && n>=1 && n<=18) return true;
    if(plainPred.includes('High') && n>=19 && n<=36) return true;
    
    // French Bets
    if(plainPred.includes('Voisins') && VOISINS.includes(n)) return true;
    if(plainPred.includes('Tiers') && TIERS.includes(n)) return true;
    if(plainPred.includes('Orphelins') && ORPHELINS.includes(n)) return true;
    
    return false;
}

function getPredictionsForHistory(historySlice) {
    if(historySlice.length < 5) return { col: 'Wait', doz: 'Wait', out: 'Wait', french: { v: 'Wait', t: 'Wait', o: 'Wait' } };
    
    // Using Standard Deviation to find statistically significant hot/cold bets
    const N = historySlice.length;
    // For 1/3 bets (Columns, Dozens): expected = N*(12/37), SD = sqrt(N * p * q) = sqrt(N * (12/37) * (25/37))
    const expectedThird = N * (12/37);
    const sdThird = Math.sqrt(N * (12/37) * (25/37));
    
    // For 1/2 bets (Outside): expected = N*(18/37), SD = sqrt(N * (18/37) * (19/37))
    const expectedHalf = N * (18/37);
    const sdHalf = Math.sqrt(N * (18/37) * (19/37));

    const sdThresh = isAggressive ? 1.0 : 1.5;
    
    // Columns
    let c1=0, c2=0, c3=0;
    historySlice.forEach(n => {
        if(n===0) return;
        if(n%3===1) c1++; else if(n%3===2) c2++; else if(n%3===0) c3++;
    });
    
    let cText = "Wait";
    // Check if any column is "Hot" (Hits > Expected + SD)
    if(c1 > expectedThird + sdThresh*sdThird) cText = "<span class='text-blue'>Play Col 1</span>";
    else if(c2 > expectedThird + sdThresh*sdThird) cText = "<span class='text-gold'>Play Col 2</span>";
    else if(c3 > expectedThird + sdThresh*sdThird) cText = "<span class='text-green'>Play Col 3</span>";
    // Alternatively check if "Due/Cold" (Hits < Expected - SD) if we want a mean reversion strategy?
    // Let's stick to hot for columns for now, or pick the hottest.
    else {
        let maxC = Math.max(c1, c2, c3);
        if(maxC === c1 && c1 > expectedThird + 0.5*sdThird) cText = "<span class='text-blue'>Play Col 1</span>";
        else if(maxC === c2 && c2 > expectedThird + 0.5*sdThird) cText = "<span class='text-gold'>Play Col 2</span>";
        else if(maxC === c3 && c3 > expectedThird + 0.5*sdThird) cText = "<span class='text-green'>Play Col 3</span>";
    }

    // Dozens
    let d1=0, d2=0, d3=0;
    historySlice.forEach(n => {
        if(n>=1 && n<=12) d1++; else if(n>=13 && n<=24) d2++; else if(n>=25 && n<=36) d3++;
    });
    let dText = "Wait";
    if(d1 > expectedThird + sdThresh*sdThird) dText = "<span class='text-blue'>Play 1 to 12</span>";
    else if(d2 > expectedThird + sdThresh*sdThird) dText = "<span class='text-gold'>Play 13 to 24</span>";
    else if(d3 > expectedThird + sdThresh*sdThird) dText = "<span class='text-green'>Play 25 to 36</span>";
    else {
        let maxD = Math.max(d1, d2, d3);
        if(maxD === d1 && d1 > expectedThird + 0.5*sdThird) dText = "<span class='text-blue'>Play 1 to 12</span>";
        else if(maxD === d2 && d2 > expectedThird + 0.5*sdThird) dText = "<span class='text-gold'>Play 13 to 24</span>";
        else if(maxD === d3 && d3 > expectedThird + 0.5*sdThird) dText = "<span class='text-green'>Play 25 to 36</span>";
    }

    // Outside
    let r=0, b=0, e=0, o=0, l=0, h=0;
    historySlice.forEach(n => {
        if(n===0)return;
        if(RED_NUMBERS.includes(n)) r++; else b++;
        if(n%2===0) e++; else o++;
        if(n<=18) l++; else h++;
    });
    
    let outScore = 0;
    let oText = "Wait";
    // Find the most statistically significant deviation
    const devs = [
        {name: "<span class='text-red'>Play RED</span>", hits: r},
        {name: "Play BLACK", hits: b},
        {name: "<span class='text-gold'>Play EVEN</span>", hits: e},
        {name: "<span class='text-gold'>Play ODD</span>", hits: o},
        {name: "<span class='text-blue'>Play 1-18 (Low)</span>", hits: l},
        {name: "<span class='text-green'>Play 19-36 (High)</span>", hits: h}
    ];
    
    devs.sort((a,b) => b.hits - a.hits);
    if(devs[0].hits > expectedHalf + (sdThresh * sdHalf * 0.8)) {
        oText = devs[0].name;
    }

    // French Bets
    let v=0, t=0, o_cnt=0;
    historySlice.forEach(n => {
        if(VOISINS.includes(n)) v++;
        else if(TIERS.includes(n)) t++;
        else if(ORPHELINS.includes(n)) o_cnt++;
    });

    const expectedV = N * (17/37); const sdV = Math.sqrt(N * (17/37) * (20/37));
    const expectedT = N * (12/37); const sdT = Math.sqrt(N * (12/37) * (25/37));
    const expectedO = N * (8/37);  const sdO = Math.sqrt(N * (8/37) * (29/37));

    let fText = { v: 'Wait', t: 'Wait', o: 'Wait' };
    if(v > expectedV + sdThresh*sdV*0.8) fText.v = "<span class='text-gold'>Play Voisins</span>";
    if(t > expectedT + sdThresh*sdT*0.8) fText.t = "<span class='text-blue'>Play Tiers</span>";
    if(o_cnt > expectedO + sdThresh*sdO*0.8) fText.o = "<span class='text-green'>Play Orphelins</span>";

    return { col: cText, doz: dText, out: oText, french: fText };
}

function calculatePnL(spins) {
    if(spins.length < 5) return [0];
    let balance = 0;
    let bHist = [0];
    
    let prog = { column: 0, dozen: 0, outside: 0, v: 0, t: 0, o: 0 };
    for(let i = 5; i < spins.length; i++) {
        let hAtPoint = spins.slice(0, i);
        let preds = getPredictionsForHistory(hAtPoint);
        let actual = spins[i];
        
        let stepCost = 0;
        let stepWin = 0;
        
        if(preds.col !== 'Wait') {
            let amt = getBetAmount(prog.column, 1.5, 'math');
            stepCost += amt;
            if(satisfiesPrediction(actual, preds.col)) { stepWin += (amt * 3); prog.column = 0; } 
            else prog.column = Math.min(prog.column + 1, 8);
        }
        if(preds.doz !== 'Wait') {
            let amt = getBetAmount(prog.dozen, 1.5, 'math');
            stepCost += amt;
            if(satisfiesPrediction(actual, preds.doz)) { stepWin += (amt * 3); prog.dozen = 0; } 
            else prog.dozen = Math.min(prog.dozen + 1, 8);
        }
        if(preds.out !== 'Wait') {
            let amt = getBetAmount(prog.outside, 2.0, 'math');
            stepCost += amt;
            if(satisfiesPrediction(actual, preds.out)) { stepWin += (amt * 2); prog.outside = 0; } 
            else prog.outside = Math.min(prog.outside + 1, 10);
        }

        if(preds.french.v !== 'Wait') {
            let amt = getBetAmount(prog.v, 1.0, 'flat');
            stepCost += amt;
            if(satisfiesPrediction(actual, preds.french.v)) { stepWin += (amt * 2); prog.v = 0; } 
            else prog.v = Math.min(prog.v + 1, 8);
        }
        if(preds.french.t !== 'Wait') {
            let amt = getBetAmount(prog.t, 1.0, 'flat');
            stepCost += amt;
            if(satisfiesPrediction(actual, preds.french.t)) { stepWin += (amt * 3); prog.t = 0; } 
            else prog.t = Math.min(prog.t + 1, 8);
        }
        if(preds.french.o !== 'Wait') {
            let amt = getBetAmount(prog.o, 1.0, 'flat');
            stepCost += amt;
            if(satisfiesPrediction(actual, preds.french.o)) { stepWin += (amt * 4); prog.o = 0; } 
            else prog.o = Math.min(prog.o + 1, 8);
        }
        
        balance = balance - stepCost + stepWin;
        bHist.push(balance);
    }
    return bHist;
}

function renderChart(dataArr) {
    let ctx = document.getElementById('pnlChart');
    if(!ctx) return;
    
    let labels = dataArr.map((_, i) => i);
    let color = dataArr[dataArr.length-1] >= 0 ? '#69f0ae' : '#ff5252';

    if(pnlChartInstance) {
        pnlChartInstance.data.labels = labels;
        pnlChartInstance.data.datasets[0].data = dataArr;
        pnlChartInstance.data.datasets[0].borderColor = color;
        pnlChartInstance.update();
    } else {
        Chart.defaults.color = '#888';
        Chart.defaults.font.family = 'Montserrat';
        pnlChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Virtual PnL',
                    data: dataArr,
                    borderColor: color,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { 
                        display: true, 
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                }
            }
        });
    }
}

function runAnalyticsAndBetting() {
    const len = spinHistory.length;
    if (len < 5) {
        resetUI();
        return;
    }

    // 1. Calculate Progression
    let prog = { column: 0, dozen: 0, outside: 0, v: 0, t: 0, o: 0 };
    for(let i = 5; i < spinHistory.length; i++) {
        let historyAtThatPoint = spinHistory.slice(0, i);
        let preds = getPredictionsForHistory(historyAtThatPoint);
        let actualHit = spinHistory[i];
        
        if(preds.col !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.col)) prog.column = 0;
            else prog.column = Math.min(prog.column + 1, 8);
        }
        if(preds.doz !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.doz)) prog.dozen = 0;
            else prog.dozen = Math.min(prog.dozen + 1, 8);
        }
        if(preds.out !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.out)) prog.outside = 0;
            else prog.outside = Math.min(prog.outside + 1, 10);
        }
        if(preds.french.v !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.french.v)) prog.v = 0;
            else prog.v = Math.min(prog.v + 1, 8);
        }
        if(preds.french.t !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.french.t)) prog.t = 0;
            else prog.t = Math.min(prog.t + 1, 8);
        }
        if(preds.french.o !== 'Wait') {
            if(satisfiesPrediction(actualHit, preds.french.o)) prog.o = 0;
            else prog.o = Math.min(prog.o + 1, 8);
        }
    }

    // 2. Current Predictions
    let currentPreds = getPredictionsForHistory(spinHistory);
    let areas = [
        { id: 'column', html: currentPreds.col, p: prog.column, mult: 1.5, type: 'math' },
        { id: 'dozen', html: currentPreds.doz, p: prog.dozen, mult: 1.5, type: 'math' },
        { id: 'outside', html: currentPreds.out, p: prog.outside, mult: 2.0, type: 'math' },
        { id: 'voisins', html: currentPreds.french.v, p: prog.v, mult: 1.0, type: 'flat' },
        { id: 'tiers', html: currentPreds.french.t, p: prog.t, mult: 1.0, type: 'flat' },
        { id: 'orphelins', html: currentPreds.french.o, p: prog.o, mult: 1.0, type: 'flat' }
    ];

    let spokenAlerts = [];

    areas.forEach(ar => {
        let pEl = document.getElementById(`pred-${ar.id}`);
        let box = document.getElementById(`box-${ar.id}`);
        let betEl = document.getElementById(`bet-${ar.id}`);
        
        if(!pEl) return;
        pEl.innerHTML = ar.html;
        
        if(ar.html !== 'Wait') {
            let bet = getBetAmount(ar.p, ar.mult, ar.type);
            
            betEl.innerHTML = `Bet ${bet} Pts`;
            betEl.className = 'bet-amt hot mt-5';
            box.classList.add('active-bet');

            let plainHtml = ar.html.replace(/<[^>]*>?/gm, '');
            spokenAlerts.push(`Bet ${bet} on ${plainHtml}`);
        } else {
            betEl.innerHTML = '--';
            betEl.className = 'bet-amt mt-5';
            box.classList.remove('active-bet');
        }
    });

    if(spokenAlerts.length > 0) {
        speakText(spokenAlerts[spokenAlerts.length - 1]);
    }

    // 3. Single Numbers via Exponential Moving Average + Momentum
    let scores = [];
    let N = spinHistory.length;
    let lastNum = spinHistory[N - 1];

    for(let i=0; i<=36; i++) {
        let sc = 0;
        
        // Momentum & Recency (decaying weight)
        for(let j=0; j<N; j++) {
            if(spinHistory[j] === i) {
                // More recent hits give higher scores (exponential decay)
                sc += Math.pow(1.05, (j - N + 20)); // Focuses on last 20 spins heavily
            }
        }
        
        // Transition Bonus
        for(let j=0; j<N-1; j++) {
            if(spinHistory[j] === lastNum && spinHistory[j+1] === i) {
                sc += 2.0;
            }
        }
        
        // Wheel Neighbors Synergy
        let idx = ROULETTE_NUMBERS.indexOf(i);
        let leftN = ROULETTE_NUMBERS[(idx - 1 + 37) % 37];
        let rightN = ROULETTE_NUMBERS[(idx + 1) % 37];
        let left2 = ROULETTE_NUMBERS[(idx - 2 + 37) % 37];
        let right2 = ROULETTE_NUMBERS[(idx + 2) % 37];
        
        let neighborHits = 0;
        let recent10 = spinHistory.slice(-10);
        recent10.forEach(rn => {
            if([leftN, rightN, left2, right2].includes(rn)) neighborHits++;
        });
        sc += neighborHits * 0.5;

        scores.push({num: i, score: sc});
    }
    
    scores.sort((a,b) => b.score - a.score);
    
    for(let i=1; i<=3; i++) {
        let el = document.getElementById(`pred-${i}`);
        let num = scores[i-1].num;
        let scoreVal = scores[i-1].score;
        
        el.innerText = num;
        el.className = `val ${getTextColorClass(num)}`;
        
        let box = document.getElementById(`box-pred-${i}`);
        let betEl = document.getElementById(`bet-${i}`);
        
        let thresh = isAggressive ? 1.0 : 1.8; 
        if(scoreVal > thresh) {
            betEl.innerHTML = `Bet ${BASE_UNIT} Pts`;
            betEl.className = 'bet-amt hot';
            box.classList.add('active-bet');
        } else {
            betEl.innerHTML = 'Wait';
            betEl.className = 'bet-amt';
            box.classList.remove('active-bet');
            box.classList.remove('highly-confident-bet');
        }
    }

    // 4. Streaks
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
        if(rCount >= 6) stText = "<span class='text-red'>Red Overbought</span>";
        else if(bCount >= 6) stText = "Black Overbought";
        else if(eCount >= 6) stText = "<span class='text-gold'>Even Overbought</span>";
        else if(oCount >= 6) stText = "<span class='text-gold'>Odd Overbought</span>";
    }
    document.getElementById('streak-alert').innerHTML = stText;

    // 5. Dealer Signature
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
            let tNums = [0,1,2,3,4].map(off => ROULETTE_NUMBERS[(lIdx + (bestStart+off)%37)%37]).sort((a,b) => a-b);
            sigText = `<span class="text-gold" style="font-size:11px;">Track: ${tNums.join(',')}</span>`;
        }
        document.getElementById('dealer-sig').innerHTML = sigText;
    }

    // 6. Progress Bars
    let recentSpins = spinHistory.slice(-30);
    let r=0, b=0, d1=0, d2=0, d3=0, nonZero=0;
    
    recentSpins.forEach(n => {
        if(n === 0) return;
        nonZero++;
        if(RED_NUMBERS.includes(n)) r++; else b++;
        if(n>=1 && n<=12) d1++; else if(n>=13 && n<=24) d2++; else if(n>=25 && n<=36) d3++;
    });

    updateBar('red', 'black', r, b, nonZero);
    
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

    // 7. Calculate Virtual PnL & Render Chart
    let bHist = calculatePnL(spinHistory);
    let currentBal = bHist[bHist.length - 1] || 0;
    
    let balEl = document.getElementById('balance-display');
    balEl.innerText = `${currentBal > 0 ? '+' : ''}${currentBal} Pts`;
    balEl.style.color = currentBal >= 0 ? '#69f0ae' : '#ff5252';

    renderChart(bHist);
    
    // 8. Async ML Override (Optimistic UI)
    fetchMLUpdate();
}

async function fetchMLUpdate() {
   try {
       let res = await fetch(`http://${serverIP}:5000/predict`, {
           method: 'POST',
           headers: {'Content-Type': 'application/json'},
           body: JSON.stringify({ spins: spinHistory })
       });
       if(res.ok) {
           updateServerStatus('Online', 'online');
           let data = await res.json();
           if(data.status === 'success') {
               let top3 = data.predictions;
               for(let i=1; i<=3; i++) {
                   let el = document.getElementById(`pred-${i}`);
                   let num = top3[i-1];
                   el.innerText = num;
                   el.className = `val ${getTextColorClass(num)}`;
                   
                   let box = document.getElementById(`box-pred-${i}`);
                   let betEl = document.getElementById(`bet-${i}`);
                   let conf = data.confidence;
                   
                   // ML Confidence overrides
                   let thresh = isAggressive ? 1.5 : 2.5; 
                   if(conf > thresh) {
                       betEl.innerHTML = `Bet ${BASE_UNIT} Pts`;
                       betEl.className = 'bet-amt hot';
                       box.classList.add('active-bet');
                       
                       // Premium Glow if confidence is very high
                       if(conf > 70) {
                           box.classList.add('highly-confident-bet');
                           el.classList.add('text-cyan');
                       } else {
                           box.classList.remove('highly-confident-bet');
                           el.classList.remove('text-cyan');
                       }
                   } else {
                       betEl.innerHTML = 'Wait';
                       betEl.className = 'bet-amt';
                       box.classList.remove('active-bet');
                       box.classList.remove('highly-confident-bet');
                       el.classList.remove('text-cyan');
                   }
               }
               document.getElementById('dealer-sig').innerHTML = `<span class='text-cyan' style='font-size:11px'>ML: ${data.model.substring(0,25)}</span>`;
           }
       } else {
           updateServerStatus('Offline', 'offline');
       }
   } catch(e) {
       console.error("ML Fetch Error: ", e);
       updateServerStatus('Offline', 'offline');
   }
}

// Boot
init();
