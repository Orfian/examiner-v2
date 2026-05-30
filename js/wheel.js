// Questions Wheel module
// Renders an SVG wheel of question sections. Spins on a button click and
// shows a modal with the picked question's full content.

const WHEEL_SVG_NS = 'http://www.w3.org/2000/svg';
const WHEEL_DEFAULT_COLOR = '#888888';
const WHEEL_PREFS_KEY = 'examiner_wheel_prefs';
// Per-DLC wheel state (hidden questions, section order, collapsed groups).
// Mirrors the prompter's session persistence so a reload restores the wheel.
const WHEEL_STATE_KEY = 'examiner_wheel_state';

function loadWheelState(name) {
    if (!name) return null;
    try {
        return (JSON.parse(localStorage.getItem(WHEEL_STATE_KEY)) || {})[name] || null;
    } catch { return null; }
}

function saveWheelState(name, state) {
    if (!name) return;
    let all = {};
    try { all = JSON.parse(localStorage.getItem(WHEEL_STATE_KEY)) || {}; } catch {}
    all[name] = state;
    try { localStorage.setItem(WHEEL_STATE_KEY, JSON.stringify(all)); } catch {}
}

function clearWheelState(name) {
    if (!name) return;
    let all = {};
    try { all = JSON.parse(localStorage.getItem(WHEEL_STATE_KEY)) || {}; } catch {}
    if (name in all) {
        delete all[name];
        try { localStorage.setItem(WHEEL_STATE_KEY, JSON.stringify(all)); } catch {}
    }
}

// Per-DLC member roster (who is answering). Kept separate from the wheel
// state so the roster survives a wheel reset — the people in the room don't
// change just because the questions were reshuffled.
const WHEEL_MEMBERS_KEY = 'examiner_wheel_members';

function loadWheelMembers(name) {
    if (!name) return [];
    try {
        let list = (JSON.parse(localStorage.getItem(WHEEL_MEMBERS_KEY)) || {})[name];
        return Array.isArray(list)
            ? list
                .filter(m => m && typeof m.id === 'string' && typeof m.name === 'string')
                .map(m => ({ id: m.id, name: m.name, disabled: m.disabled === true }))
            : [];
    } catch { return []; }
}

function saveWheelMembers(name, members) {
    if (!name) return;
    let all = {};
    try { all = JSON.parse(localStorage.getItem(WHEEL_MEMBERS_KEY)) || {}; } catch {}
    all[name] = members;
    try { localStorage.setItem(WHEEL_MEMBERS_KEY, JSON.stringify(all)); } catch {}
}

// True only when the saved state reflects real progress — i.e. the user hid a
// question or shuffled the order. Group collapse state is just a view
// preference (and may be set automatically for large DLCs), so it does not
// count; a wheel that was merely opened is not "meaningful" and should not
// trigger the continue/reset prompt.
function isMeaningfulWheelState(saved, questions) {
    if (!saved) return false;
    if (Array.isArray(saved.hidden) && saved.hidden.length > 0) return true;
    if (saved.answered && typeof saved.answered === 'object'
        && Object.keys(saved.answered).some(qid => Array.isArray(saved.answered[qid]) && saved.answered[qid].length > 0)) {
        return true;
    }
    if (Array.isArray(saved.order) && Array.isArray(questions)) {
        let orig = questions.map(q => q.id);
        if (saved.order.length !== orig.length) return true;
        for (let i = 0; i < orig.length; i++) {
            if (saved.order[i] !== orig[i]) return true;
        }
    }
    return false;
}

// Leaving the wheel: when there's nothing worth keeping, just go back to the
// start screen; otherwise let the user choose to keep the wheel state (which is
// already auto-saved) or discard it.
function leaveWheel() {
    let name = (typeof currentDlcName === 'string') ? currentDlcName : null;
    if (!wheelInstance || !wheelInstance.hasMeaningfulProgress()) {
        clearWheelState(name);
        window.location.reload();
        return;
    }
    showSaveLeaveDialog('wheelView',
        function () { window.location.reload(); },                  // keep the auto-saved state
        function () { clearWheelState(name); window.location.reload(); });
}

const WHEEL_DEFAULT_PREFS = {
    size: 100,
    textScale: 50,
    spinTimeMs: 4000,
    hubSize: 15,
    showHints: true,
    textOuter: false,
    dynamicRotation: false,
    centered: true,
    timerEnabled: false,
    // 'always' (default) ticks the global timer continuously;
    // 'in-question' only counts while a question is open.
    timerContinuous: true,
    membersEnabled: false,
};

let wheelInstance = null;

function loadWheelPrefs() {
    try {
        let p = JSON.parse(localStorage.getItem(WHEEL_PREFS_KEY));
        if (p && typeof p === 'object') {
            return {
                size:            typeof p.size === 'number' ? p.size : WHEEL_DEFAULT_PREFS.size,
                textScale:       typeof p.textScale === 'number' ? p.textScale : WHEEL_DEFAULT_PREFS.textScale,
                spinTimeMs:      typeof p.spinTimeMs === 'number' ? p.spinTimeMs : WHEEL_DEFAULT_PREFS.spinTimeMs,
                hubSize:         typeof p.hubSize === 'number' ? p.hubSize : WHEEL_DEFAULT_PREFS.hubSize,
                showHints:       p.showHints !== false,
                textOuter:       p.textOuter === true,
                dynamicRotation: p.dynamicRotation === true,
                centered:        p.centered !== false,
                timerEnabled:    p.timerEnabled === true,
                timerContinuous: p.timerContinuous !== false,
                membersEnabled:  p.membersEnabled === true,
            };
        }
    } catch {}
    return Object.assign({}, WHEEL_DEFAULT_PREFS);
}

function saveWheelPrefs(prefs) {
    try { localStorage.setItem(WHEEL_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function startWheel(dlc) {
    document.getElementById('title').hidden = true;
    document.getElementById('examiner').hidden = true;
    document.getElementById('wheelView').hidden = false;
    document.body.style.overflow = 'hidden';

    let nameEl = document.getElementById('wheel-dlc-name');
    if (nameEl) nameEl.innerText = dlc.name || 'Questions Wheel';
    document.title = (dlc.name || 'Questions Wheel') + ' - Examiner v2';

    wheelInstance = new QuestionsWheel(dlc.data, dlc.groups);
    wheelInstance.attach();
}

function toggleWheelConfig(event) {
    if (event) event.stopPropagation();
    let panel = document.getElementById('wheelConfigPanel');
    if (!panel) return;
    let willOpen = panel.hidden;
    // Close sound and members panels too so they don't stack
    document.querySelectorAll('.sound-panel').forEach(p => p.hidden = true);
    let members = document.getElementById('wheelMembersManagePanel');
    if (members) members.hidden = true;
    panel.hidden = !willOpen;
}

function toggleWheelMembersPanel(event) {
    if (event) event.stopPropagation();
    let panel = document.getElementById('wheelMembersManagePanel');
    if (!panel) return;
    let willOpen = panel.hidden;
    // Close sound and config panels so only one is open at a time.
    document.querySelectorAll('.sound-panel').forEach(p => p.hidden = true);
    let cfg = document.getElementById('wheelConfigPanel');
    if (cfg) cfg.hidden = true;
    panel.hidden = !willOpen;
    if (willOpen && wheelInstance) {
        wheelInstance.renderMembersConfig();
        let input = document.getElementById('wheelMemberInput');
        if (input) input.focus();
    }
}

function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
}

class QuestionsWheel {
    constructor(questions, groups) {
        // Master list (input order). The sidebar always renders this set,
        // sorted by color, so it stays easy to find a question.
        this.questions = questions.slice();
        // Order used to lay sections on the wheel — shuffled independently
        // of the sidebar order.
        this.wheelOrder = questions.slice();
        this.hidden = new Set();
        this.rotation = 0;
        this.spinning = false;
        this.selected = null;
        this.searchQuery = '';
        this.prefs = loadWheelPrefs();
        this.hintRevealed = false;
        // Groups come from the DLC itself, not from user settings. A
        // question may reference a group by its id (short) or its name.
        this.groups = Array.isArray(groups)
            ? groups.filter(g => g && typeof g.name === 'string')
            : [];
        this.questionGroups = {};
        this.questions.forEach(q => {
            let g = q && q.question && q.question.group;
            if ((typeof g === 'string' && g) || typeof g === 'number') {
                this.questionGroups[q.id] = g;
            }
        });
        this.collapsedGroups = new Set();
        this.timerInterval = null;
        this.timerStart = 0;

        // Member roster (persists per DLC) and per-question answered tracking
        // (part of the resettable wheel state). rolledMemberId is transient —
        // it just highlights the last "Roll" result in the open modal.
        this.members = loadWheelMembers(this.stateName);
        this.answered = {};
        this.rolledMemberId = null;
        this.rolling = false;
        this._rollRaf = null;

        let hadSavedState = !!loadWheelState(this.stateName);
        this.restoreState();
        // On a fresh open of a large grouped DLC, collapse the named group
        // sections (the Ungrouped section stays expanded) so the list stays
        // manageable.
        if (!hadSavedState && this.questions.length > 15) {
            this.collapseAllSections();
        }
    }

    // Collapses every named group section, leaving the Ungrouped section
    // expanded. No-op for DLCs that don't use groups, since there are no
    // group sections to collapse.
    collapseAllSections() {
        let useGroups = this.groups.length > 0
            && this.questions.some(q => this.findGroup(this.questionGroups[q.id]));
        if (!useGroups) return;
        this.groups.forEach(g => this.collapsedGroups.add(g.name));
    }

    get active() {
        return this.wheelOrder.filter(q => !this.hidden.has(q.id));
    }

    // Name used to key persisted state (hidden/order) — same name the rest of
    // the app uses for sessions, recent files and scores.
    get stateName() {
        return (typeof currentDlcName === 'string' && currentDlcName) ? currentDlcName : null;
    }

    restoreState() {
        let saved = loadWheelState(this.stateName);
        if (!saved) return;
        if (Array.isArray(saved.hidden)) this.hidden = new Set(saved.hidden);
        if (Array.isArray(saved.collapsed)) this.collapsedGroups = new Set(saved.collapsed);
        if (saved.answered && typeof saved.answered === 'object') {
            // Keep only known members so a removed member can't linger.
            let valid = new Set(this.members.map(m => m.id));
            let restored = {};
            Object.keys(saved.answered).forEach(qid => {
                let ids = saved.answered[qid];
                if (Array.isArray(ids)) {
                    let kept = ids.filter(id => valid.has(id));
                    if (kept.length) restored[qid] = kept;
                }
            });
            this.answered = restored;
        }
        if (Array.isArray(saved.order)) {
            let byId = {};
            this.questions.forEach(q => { byId[q.id] = q; });
            let seen = new Set();
            let restored = [];
            saved.order.forEach(id => {
                if (byId[id] && !seen.has(id)) { restored.push(byId[id]); seen.add(id); }
            });
            // Append any questions added since the state was saved.
            this.questions.forEach(q => { if (!seen.has(q.id)) restored.push(q); });
            if (restored.length) this.wheelOrder = restored;
        }
    }

    persistState() {
        if (!this.stateName) return;
        saveWheelState(this.stateName, {
            hidden: Array.from(this.hidden),
            order: this.wheelOrder.map(q => q.id),
            collapsed: Array.from(this.collapsedGroups),
            answered: this.answered,
        });
    }

    // Whether the wheel state holds anything the user would miss on reset:
    // hidden questions, recorded answers, or a reordered wheel. (Star ratings
    // live outside this state and are never lost on leave.)
    hasMeaningfulProgress() {
        if (this.hidden.size > 0) return true;
        if (Object.keys(this.answered).some(qid =>
            Array.isArray(this.answered[qid]) && this.answered[qid].length > 0)) {
            return true;
        }
        let orig = this.questions.map(q => q.id);
        let cur = this.wheelOrder.map(q => q.id);
        if (cur.length !== orig.length) return true;
        for (let i = 0; i < orig.length; i++) {
            if (cur[i] !== orig[i]) return true;
        }
        return false;
    }

    attach() {
        this.initTimers();
        this.applySize();
        this.applyTextScale();
        this.applyHubSize();
        this.applyCentered();
        this.applyTimerVisibility();

        let hub = document.getElementById('wheelHub');
        if (hub) hub.onclick = () => this.spin();

        let globalPauseBtn = document.getElementById('wheelGlobalPauseBtn');
        if (globalPauseBtn) globalPauseBtn.onclick = () => this.toggleGlobalPause();
        let qPauseBtn = document.getElementById('wheelModalTimerPauseBtn');
        if (qPauseBtn) qPauseBtn.onclick = () => this.toggleQuestionPause();
        let qResetBtn = document.getElementById('wheelModalTimerResetBtn');
        if (qResetBtn) qResetBtn.onclick = () => this.resetQuestionTimer();

        document.getElementById('wheelModalClose').onclick = () => {
            playSound('next');
            this.closeModal();
        };
        document.getElementById('wheelModalHide').onclick = () => {
            playSound('navigate');
            this.hideSelected();
        };
        document.getElementById('wheelModalShowHint').onclick = () => {
            // 'show' is played by toggleHintReveal when actually revealing
            this.toggleHintReveal();
        };

        // Spacebar triggers spin when the modal is not open
        let anyOverlayOpen = () => ['wheelMemberDetailModal', 'wheelChoiceModal', 'wheelStatsModal']
            .some(id => { let el = document.getElementById(id); return el && !el.hidden; });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                let stats = document.getElementById('wheelStatsModal');
                if (stats && !stats.hidden) { this.closeStatsModal(); return; }
                let detail = document.getElementById('wheelMemberDetailModal');
                if (detail && !detail.hidden) { this.closeMemberDetail(); return; }
                let choice = document.getElementById('wheelChoiceModal');
                if (choice && !choice.hidden) { this.closeChoice(); return; }
            }
            if (e.code !== 'Space') return;
            if (!document.getElementById('wheelModal').hidden) return;
            if (anyOverlayOpen()) return;
            e.preventDefault();
            this.spin();
        });

        let memberDetailClose = document.getElementById('wheelMemberDetailClose');
        if (memberDetailClose) memberDetailClose.onclick = () => { playSound('next'); this.closeMemberDetail(); };
        let memberDetailModal = document.getElementById('wheelMemberDetailModal');
        if (memberDetailModal) memberDetailModal.onclick = (e) => {
            if (e.target === memberDetailModal) this.closeMemberDetail();
        };

        let statsClose = document.getElementById('wheelStatsClose');
        if (statsClose) statsClose.onclick = () => { playSound('next'); this.closeStatsModal(); };
        let statsModal = document.getElementById('wheelStatsModal');
        if (statsModal) statsModal.onclick = (e) => {
            if (e.target === statsModal) this.closeStatsModal();
        };

        let statsBtn = document.getElementById('wheelStatsBtn');
        if (statsBtn) statsBtn.onclick = () => this.openStatsModal();

        let choiceCancel = document.getElementById('wheelChoiceCancel');
        if (choiceCancel) choiceCancel.onclick = () => { playSound('next'); this.closeChoice(); };
        let choiceModal = document.getElementById('wheelChoiceModal');
        if (choiceModal) choiceModal.onclick = (e) => {
            if (e.target === choiceModal) this.closeChoice();
        };

        // ── Config panel ─────────────────────────────────────────────────────
        let sizeSlider = document.getElementById('wheelSizeSlider');
        if (sizeSlider) {
            sizeSlider.value = this.prefs.size;
            this.updateSizeLabel();
            sizeSlider.oninput = (e) => {
                this.prefs.size = parseInt(e.target.value, 10);
                this.applySize();
                this.updateSizeLabel();
                saveWheelPrefs(this.prefs);
            };
        }

        let textSlider = document.getElementById('wheelTextSizeSlider');
        if (textSlider) {
            textSlider.value = this.prefs.textScale;
            this.updateTextLabel();
            textSlider.oninput = (e) => {
                this.prefs.textScale = parseInt(e.target.value, 10);
                this.applyTextScale();
                this.updateTextLabel();
                this.renderWheel();
                saveWheelPrefs(this.prefs);
            };
        }

        let spinSlider = document.getElementById('wheelSpinTimeSlider');
        if (spinSlider) {
            spinSlider.value = this.prefs.spinTimeMs;
            this.updateSpinTimeLabel();
            spinSlider.oninput = (e) => {
                this.prefs.spinTimeMs = parseInt(e.target.value, 10);
                this.updateSpinTimeLabel();
                saveWheelPrefs(this.prefs);
            };
        }

        let hubSlider = document.getElementById('wheelHubSizeSlider');
        if (hubSlider) {
            hubSlider.value = this.prefs.hubSize;
            this.updateHubSizeLabel();
            hubSlider.oninput = (e) => {
                this.prefs.hubSize = parseInt(e.target.value, 10);
                this.applyHubSize();
                this.updateHubSizeLabel();
                this.renderWheel();
                saveWheelPrefs(this.prefs);
            };
        }

        // ── Editable value inputs ─────────────────────────────────────────────
        // Helper: wire a text input so the user can type a value directly.
        // parse(str) → raw number (in the displayed unit), apply(clamped) runs
        // the side-effects, refresh() re-renders the current stored value.
        let bindValueInput = (inputId, sliderEl, min, max, step, parse, apply, refresh) => {
            let inp = document.getElementById(inputId);
            if (!inp) return;
            inp.addEventListener('focus', () => inp.select());
            let commit = () => {
                let v = parse(inp.value);
                if (!isNaN(v) && isFinite(v)) {
                    v = Math.max(min, Math.min(max, Math.round(v / step) * step));
                    if (sliderEl) sliderEl.value = v;
                    apply(v);
                }
                refresh();
            };
            inp.addEventListener('blur', commit);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); inp.blur(); }
                else if (e.key === 'Escape') { refresh(); inp.blur(); }
            });
        };

        bindValueInput('wheelSizeValue', sizeSlider, 60, 200, 5,
            s => parseInt(s, 10),
            v => { this.prefs.size = v; this.applySize(); saveWheelPrefs(this.prefs); },
            () => this.updateSizeLabel()
        );
        bindValueInput('wheelTextSizeValue', textSlider, 20, 400, 5,
            s => parseInt(s, 10),
            v => { this.prefs.textScale = v; this.applyTextScale(); this.renderWheel(); saveWheelPrefs(this.prefs); },
            () => this.updateTextLabel()
        );
        bindValueInput('wheelSpinTimeValue', spinSlider, 1000, 10000, 250,
            s => Math.round(parseFloat(s) * 1000),
            v => { this.prefs.spinTimeMs = v; saveWheelPrefs(this.prefs); },
            () => this.updateSpinTimeLabel()
        );
        bindValueInput('wheelHubSizeValue', hubSlider, 8, 40, 1,
            s => parseInt(s, 10),
            v => { this.prefs.hubSize = v; this.applyHubSize(); this.renderWheel(); saveWheelPrefs(this.prefs); },
            () => this.updateHubSizeLabel()
        );

        let hintsSwitch = document.getElementById('wheelHintsSwitch');
        let hintsRow = document.getElementById('wheelHintsRow');
        let updateSwitch = () => hintsSwitch.classList.toggle('on', this.prefs.showHints);
        updateSwitch();
        if (hintsRow) {
            hintsRow.onclick = (e) => {
                e.preventDefault();
                this.prefs.showHints = !this.prefs.showHints;
                updateSwitch();
                saveWheelPrefs(this.prefs);
                // Re-apply to currently open modal, if any
                if (!document.getElementById('wheelModal').hidden && this.selected) {
                    this.applyHintsButton();
                }
            };
        }

        let scoringSwitch = document.getElementById('wheelScoringSwitch');
        let scoringRow = document.getElementById('wheelScoringRow');
        let updateScoringSwitch = () => {
            scoringSwitch && scoringSwitch.classList.toggle('on', isScoringEnabled());
            let sb = document.getElementById('wheelStatsBtn');
            if (sb) sb.hidden = !isScoringEnabled();
        };
        updateScoringSwitch();
        if (scoringRow) {
            scoringRow.onclick = (e) => {
                e.preventDefault();
                setScoringEnabled(!isScoringEnabled());
                updateScoringSwitch();
                this.renderSidebar();
                if (!document.getElementById('wheelModal').hidden) this.refreshModalScore();
            };
        }

        let outerSwitch = document.getElementById('wheelTextOuterSwitch');
        let outerRow = document.getElementById('wheelTextOuterRow');
        let updateOuterSwitch = () => outerSwitch && outerSwitch.classList.toggle('on', this.prefs.textOuter);
        updateOuterSwitch();
        if (outerRow) {
            outerRow.onclick = (e) => {
                e.preventDefault();
                this.prefs.textOuter = !this.prefs.textOuter;
                updateOuterSwitch();
                saveWheelPrefs(this.prefs);
                this.renderWheel();
            };
        }

        let dynSwitch = document.getElementById('wheelDynamicRotationSwitch');
        let dynRow = document.getElementById('wheelDynamicRotationRow');
        let updateDynSwitch = () => dynSwitch && dynSwitch.classList.toggle('on', this.prefs.dynamicRotation);
        updateDynSwitch();
        if (dynRow) {
            dynRow.onclick = (e) => {
                e.preventDefault();
                this.prefs.dynamicRotation = !this.prefs.dynamicRotation;
                updateDynSwitch();
                saveWheelPrefs(this.prefs);
                this.renderWheel();
            };
        }

        let centeredSwitch = document.getElementById('wheelCenteredSwitch');
        let centeredRow = document.getElementById('wheelCenteredRow');
        let updateCenteredSwitch = () => centeredSwitch && centeredSwitch.classList.toggle('on', this.prefs.centered);
        updateCenteredSwitch();
        if (centeredRow) {
            centeredRow.onclick = (e) => {
                e.preventDefault();
                if (this.isMobile()) return;
                this.prefs.centered = !this.prefs.centered;
                updateCenteredSwitch();
                saveWheelPrefs(this.prefs);
                this.applyCentered();
            };
        }
        let applyCenteredAvailability = () => {
            let mobile = this.isMobile();
            if (centeredRow) {
                centeredRow.style.opacity = mobile ? '0.38' : '';
                centeredRow.style.pointerEvents = mobile ? 'none' : '';
                centeredRow.title = mobile ? 'Not available on small screens' : '';
            }
            this.applyCentered();
        };
        applyCenteredAvailability();
        window.addEventListener('resize', applyCenteredAvailability);

        let timerSwitch = document.getElementById('wheelTimerSwitch');
        let timerRow = document.getElementById('wheelTimerRow');
        let timerContSwitch = document.getElementById('wheelTimerContinuousSwitch');
        let timerContRow = document.getElementById('wheelTimerContinuousRow');
        let updateTimerSwitch = () => timerSwitch && timerSwitch.classList.toggle('on', this.prefs.timerEnabled);
        let updateTimerContSwitch = () => {
            timerContSwitch && timerContSwitch.classList.toggle('on', this.prefs.timerContinuous);
            // The "Count always" sub-option is only meaningful when the
            // timer feature itself is enabled.
            if (timerContRow) {
                timerContRow.style.opacity = this.prefs.timerEnabled ? '' : '0.38';
                timerContRow.style.pointerEvents = this.prefs.timerEnabled ? '' : 'none';
            }
        };
        updateTimerSwitch();
        updateTimerContSwitch();
        if (timerRow) {
            timerRow.onclick = (e) => {
                e.preventDefault();
                this.prefs.timerEnabled = !this.prefs.timerEnabled;
                updateTimerSwitch();
                updateTimerContSwitch();
                saveWheelPrefs(this.prefs);
                this.applyTimerVisibility();
                // If a question is open, the timer should start counting
                // right away when newly enabled, and stop when disabled.
                if (!this.prefs.timerEnabled) {
                    this.stopTimer();
                } else if (this.selected) {
                    let side = document.getElementById('wheelModalSide');
                    if (side) side.hidden = false;
                    this.startTimer();
                }
            };
        }
        if (timerContRow) {
            timerContRow.onclick = (e) => {
                e.preventDefault();
                if (!this.prefs.timerEnabled) return;
                this.prefs.timerContinuous = !this.prefs.timerContinuous;
                updateTimerContSwitch();
                saveWheelPrefs(this.prefs);
                this.applyTimerVisibility();
            };
        }

        let membersSwitch = document.getElementById('wheelMembersSwitch');
        let membersRow = document.getElementById('wheelMembersRow');
        let updateMembersSwitch = () => membersSwitch && membersSwitch.classList.toggle('on', this.prefs.membersEnabled);
        updateMembersSwitch();
        this.applyMembersFeatureVisibility();
        if (membersRow) {
            membersRow.onclick = (e) => {
                e.preventDefault();
                this.prefs.membersEnabled = !this.prefs.membersEnabled;
                updateMembersSwitch();
                saveWheelPrefs(this.prefs);
                this.applyMembersFeatureVisibility();
                this.renderSidebar();
                // Reflect the change in an open modal right away.
                if (!document.getElementById('wheelModal').hidden) {
                    this.applyMembersButton();
                    if (!this.prefs.membersEnabled) this.closeMembersPanel();
                }
            };
        }

        let memberInput = document.getElementById('wheelMemberInput');
        let memberAddBtn = document.getElementById('wheelMemberAddBtn');
        let commitMember = () => {
            if (!memberInput) return;
            if (this.addMember(memberInput.value)) {
                memberInput.value = '';
            }
            memberInput.focus();
        };
        if (memberAddBtn) memberAddBtn.onclick = commitMember;
        if (memberInput) {
            memberInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); commitMember(); }
            });
            // Typing inside the panel shouldn't bubble to the spacebar-spin
            // handler or the outside-click closer.
            memberInput.addEventListener('keydown', e => e.stopPropagation());
        }
        this.renderMembersConfig();

        let showBtn = document.getElementById('wheelMembersShowPendingBtn');
        if (showBtn) showBtn.onclick = () => this.showChoice('Show questions', [
            {
                label: 'Some member hasn\'t answered',
                desc: 'Show only questions at least one member still hasn\'t answered.',
                fn: () => this.showOnlyNotFullyAnswered(),
            },
            {
                label: 'Nobody has answered',
                desc: 'Show only questions that no member has answered yet.',
                fn: () => this.showOnlyUnansweredByAnyone(),
            },
        ]);
        let hideBtn = document.getElementById('wheelMembersHideAnsweredBtn');
        if (hideBtn) hideBtn.onclick = () => this.showChoice('Hide questions', [
            {
                label: 'Every member has answered',
                desc: 'Hide questions that all enabled members have already answered.',
                fn: () => this.hideFullyAnsweredQuestions(),
            },
            {
                label: 'Some member has answered',
                desc: 'Hide questions that at least one member has answered.',
                fn: () => this.hideAnsweredBySomeone(),
            },
        ]);

        let rollBtn = document.getElementById('wheelMembersRollBtn');
        if (rollBtn) rollBtn.onclick = () => this.rollMember();

        let membersBtn = document.getElementById('wheelModalMembersBtn');
        if (membersBtn) membersBtn.onclick = () => this.toggleMembersPanel();

        let exportBtn = document.getElementById('wheelExportBtn');
        if (exportBtn) {
            exportBtn.onclick = () => {
                let panel = document.getElementById('wheelConfigPanel');
                if (panel) panel.hidden = true;
                this.showChoice('Export', [
                    {
                        label: 'This DLC\'s progress',
                        desc: 'Download all saved data for this DLC (ratings, wheel state, members) as a transferable file.',
                        fn: () => exportDlcData(currentDlcName),
                    },
                    {
                        label: 'Ratings table',
                        desc: 'Download just your star ratings as a text table (per question and group).',
                        fn: () => this.exportRatings(),
                    },
                ]);
            };
        }

        let eraseBtn = document.getElementById('wheelEraseRatingsBtn');
        if (eraseBtn) {
            eraseBtn.onclick = () => {
                let panel = document.getElementById('wheelConfigPanel');
                if (panel) panel.hidden = true;
                showConfirmscreen('wheelView',
                    'Erase all star ratings for<br><em>' + (currentDlcName || 'this DLC') + '</em>?<br>This cannot be undone.',
                    () => {
                        clearAllScoresForDlc();
                        document.getElementById('wheelView').hidden = false;
                        this.renderSidebar();
                        if (!document.getElementById('wheelModal').hidden) this.refreshModalScore();
                        playSound('deselect');
                    });
            };
        }

        // Close config panel on outside click
        let configPanel = document.getElementById('wheelConfigPanel');
        let configBtn = document.getElementById('wheelConfigButton');
        if (configPanel) configPanel.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', (e) => {
            if (!configPanel || configPanel.hidden) return;
            if (configBtn && configBtn.contains(e.target)) return;
            if (configPanel.contains(e.target)) return;
            configPanel.hidden = true;
        });

        // Same close-on-outside-click behaviour for the members roster panel.
        let membersPanel = document.getElementById('wheelMembersManagePanel');
        let membersPanelBtn = document.getElementById('wheelMembersButton');
        if (membersPanel) membersPanel.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', (e) => {
            if (!membersPanel || membersPanel.hidden) return;
            if (membersPanelBtn && membersPanelBtn.contains(e.target)) return;
            if (membersPanel.contains(e.target)) return;
            membersPanel.hidden = true;
        });

        // ── Sidebar controls ─────────────────────────────────────────────────
        let searchBtn = document.getElementById('wheelSearchBtn');
        let searchBar = document.getElementById('wheelSearchBar');
        let searchInput = document.getElementById('wheelQuestionSearch');
        if (searchBtn) {
            searchBtn.onclick = () => {
                searchBar.hidden = !searchBar.hidden;
                if (!searchBar.hidden) {
                    searchInput.focus();
                } else {
                    searchInput.value = '';
                    this.searchQuery = '';
                    this.renderSidebar();
                }
            };
        }
        if (searchInput) {
            searchInput.oninput = (e) => {
                this.searchQuery = e.target.value.trim().toLowerCase();
                this.renderSidebar();
            };
        }

        let shuffleBtn = document.getElementById('wheelShuffleBtn');
        if (shuffleBtn) {
            shuffleBtn.onclick = () => this.shuffleWheel();
        }

        let showAllBtn = document.getElementById('wheelShowAllBtn');
        if (showAllBtn) {
            showAllBtn.onclick = () => this.toggleAllQuestions();
        }

        this.render();
    }

    // Exports the star ratings for the current DLC as a text table, one row per
    // rated question (group + overall rating), plus a column per member showing
    // that member's own difficulty rating. Ordered by group then title.
    exportRatings() {
        let scores = getAllScores()[currentDlcName] || {};

        // Members who rated at least one question get their own column.
        let ratingMembers = this.members.filter(m =>
            this.questions.some(q => getMemberQuestionScore(q.id, m.id) > 0));

        // Overall rating shown to the user: manual override, else member average.
        let overallOf = q => {
            let manual = scores[q.id] || 0;
            return manual > 0 ? manual : getMemberAverageScore(q.id);
        };

        // A question is exportable if it has an overall rating or any member
        // left a rating for it.
        let rated = this.questions.filter(q =>
            overallOf(q) > 0 || ratingMembers.some(m => getMemberQuestionScore(q.id, m.id) > 0));
        if (rated.length === 0) {
            alert('No star ratings to export yet.');
            return;
        }

        let titleOf = q => (q.question && q.question.title) || ('Question #' + q.id);
        let groupNameOf = q => {
            let g = this.findGroup(this.questionGroups[q.id]);
            return g ? g.name : 'Ungrouped';
        };

        let groupOrder = {};
        this.groups.forEach((g, i) => { groupOrder[g.name] = i; });
        let orderIndex = name => (name in groupOrder ? groupOrder[name] : this.groups.length);

        let sorted = rated.slice().sort((a, b) => {
            let ga = groupNameOf(a), gb = groupNameOf(b);
            let oa = orderIndex(ga), ob = orderIndex(gb);
            if (oa !== ob) return oa - ob;
            if (ga !== gb) return ga.localeCompare(gb);
            return titleOf(a).localeCompare(titleOf(b));
        });

        let cell = v => String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ');
        let headers = ['Group', 'ID', 'Question', 'Rating', ...ratingMembers.map(m => m.name)];
        let alignRight = [false, true, false, true, ...ratingMembers.map(() => true)];
        let rows = sorted.map(q => {
            let base = [groupNameOf(q), q.id, titleOf(q), overallOf(q)];
            let memberCells = ratingMembers.map(m => {
                let s = getMemberQuestionScore(q.id, m.id);
                return s > 0 ? s : '';
            });
            return base.concat(memberCells).map(cell);
        });

        let widths = headers.map((h, i) =>
            Math.max(h.length, ...rows.map(r => r[i].length)));
        let pad = (c, i) => alignRight[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]);
        let sep = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
        let fmtRow = cells => '| ' + cells.map(pad).join(' | ') + ' |';

        let lines = [sep, fmtRow(headers), sep];
        rows.forEach(r => lines.push(fmtRow(r)));
        lines.push(sep);

        let heading = 'Star ratings — ' + (currentDlcName || 'this DLC') +
            '  (' + rows.length + ' rated)';
        let table = heading + '\n\n' + lines.join('\n') + '\n';

        let base = (typeof currentDlcName === 'string' && currentDlcName ? currentDlcName : 'examiner')
            .replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_') || 'examiner';
        this.downloadFile(base + '-ratings.txt', table, 'text/plain;charset=utf-8');
        playSound('select');
    }

    downloadFile(filename, content, mime) {
        let blob = new Blob([content], { type: mime });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ── Members ───────────────────────────────────────────────────────────────

    // The roster-editing button (next to the gear) only exists while the
    // members feature is on; turning it off also closes its panel.
    applyMembersFeatureVisibility() {
        let btn = document.getElementById('wheelMembersButton');
        if (btn) btn.hidden = !this.prefs.membersEnabled;
        if (!this.prefs.membersEnabled) {
            let panel = document.getElementById('wheelMembersManagePanel');
            if (panel) panel.hidden = true;
        }
    }

    addMember(name) {
        name = (name || '').trim();
        if (!name) return false;
        // Case-insensitive duplicate guard so the roster stays unambiguous.
        if (this.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
            return false;
        }
        let id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this.members.push({ id, name, disabled: false });
        saveWheelMembers(this.stateName, this.members);
        this.renderMembersConfig();
        this.renderMembersPanel();
        this.renderSidebar();
        playSound('select');
        return true;
    }

    removeMember(id) {
        let idx = this.members.findIndex(m => m.id === id);
        if (idx < 0) return;
        this.members.splice(idx, 1);
        saveWheelMembers(this.stateName, this.members);
        // Drop the removed member from every question's answered list.
        Object.keys(this.answered).forEach(qid => {
            this.answered[qid] = this.answered[qid].filter(mid => mid !== id);
            if (this.answered[qid].length === 0) delete this.answered[qid];
        });
        if (this.rolledMemberId === id) this.rolledMemberId = null;
        removeMemberScores(id);
        this.persistState();
        this.renderMembersConfig();
        this.renderMembersPanel();
        this.renderSidebar();
        playSound('deselect');
    }

    // Renames a member in place. Returns false (and changes nothing) when the
    // name is empty or already taken by another member.
    renameMember(id, name) {
        name = (name || '').trim();
        if (!name) return false;
        let m = this.members.find(x => x.id === id);
        if (!m) return false;
        if (this.members.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
            return false;
        }
        if (m.name === name) return true;
        m.name = name;
        saveWheelMembers(this.stateName, this.members);
        this.renderMembersConfig();
        this.renderMembersPanel();
        this.renderSidebar();
        return true;
    }

    // Temporarily takes a member out of the rotation (or puts them back).
    // Disabled members are skipped by the roll and don't count toward
    // completion — disabling the last pending member can complete a question.
    setMemberDisabled(id, disabled) {
        let m = this.members.find(x => x.id === id);
        if (!m || m.disabled === disabled) return;
        m.disabled = disabled;
        saveWheelMembers(this.stateName, this.members);
        if (disabled && this.rolledMemberId === id) this.rolledMemberId = null;
        playSound(disabled ? 'deselect' : 'select');
        this.renderMembersConfig();
        if (!this.maybeCompleteSelected()) {
            this.persistState();
            this.renderMembersPanel();
            this.renderSidebar();
        }
    }

    renderMembersConfig() {
        let list = document.getElementById('wheelMembersConfigList');
        if (!list) return;
        list.innerHTML = '';
        if (this.members.length === 0) {
            let empty = document.createElement('div');
            empty.className = 'wheel-members-config-empty';
            empty.textContent = 'No members yet.';
            list.appendChild(empty);
            return;
        }
        this.members.forEach(m => {
            let row = document.createElement('div');
            row.className = 'wheel-member-config-row' + (m.disabled ? ' disabled' : '');

            let nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'wheel-member-config-name-input';
            nameInput.value = m.name;
            nameInput.maxLength = 40;
            nameInput.title = 'Rename member';
            // Keep typing local — don't trigger spacebar-spin or panel close.
            nameInput.addEventListener('keydown', e => e.stopPropagation());
            let commit = () => { if (!this.renameMember(m.id, nameInput.value)) nameInput.value = m.name; };
            nameInput.addEventListener('blur', commit);
            nameInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
                else if (e.key === 'Escape') { nameInput.value = m.name; nameInput.blur(); }
            });

            let toggle = document.createElement('span');
            toggle.className = 'sound-switch wheel-member-enable-switch' + (m.disabled ? '' : ' on');
            toggle.title = m.disabled ? 'Disabled — click to enable' : 'Enabled — click to disable';
            toggle.onclick = () => this.setMemberDisabled(m.id, !m.disabled);

            let count = document.createElement('span');
            count.className = 'wheel-member-count clickable';
            count.textContent = '(' + this.answeredCountForMember(m.id) + ')';
            count.title = 'Show answered questions by category';
            count.onclick = () => this.showMemberAnswers(m.id);

            let del = document.createElement('button');
            del.type = 'button';
            del.className = 'wheel-member-config-remove';
            del.title = 'Remove member';
            del.textContent = '✕';
            del.onclick = () => this.removeMember(m.id);

            row.appendChild(nameInput);
            row.appendChild(count);
            row.appendChild(toggle);
            row.appendChild(del);
            list.appendChild(row);
        });
    }

    answeredIds(qid) {
        return this.answered[qid] || [];
    }

    isAnswered(qid, memberId) {
        return this.answeredIds(qid).indexOf(memberId) >= 0;
    }

    // Total number of questions this member has marked answered (across the
    // whole DLC).
    answeredCountForMember(memberId) {
        let n = 0;
        for (let qid in this.answered) {
            if (this.answered[qid].indexOf(memberId) >= 0) n++;
        }
        return n;
    }

    // Opens a breakdown of the questions a member has answered, bucketed by
    // category (in the wheel's group order). Each row also shows the member's
    // own difficulty rating for that question when scoring is on.
    showMemberAnswers(memberId) {
        let member = this.members.find(m => m.id === memberId);
        let modal = document.getElementById('wheelMemberDetailModal');
        let titleEl = document.getElementById('wheelMemberDetailTitle');
        let body = document.getElementById('wheelMemberDetailBody');
        if (!member || !modal || !body) return;

        if (titleEl) titleEl.textContent = member.name;
        body.innerHTML = '';

        let titleOf = q => (q.question && q.question.title) || ('Question #' + q.id);
        let groupNameOf = q => {
            let g = this.findGroup(this.questionGroups[q.id]);
            return g ? g.name : 'Ungrouped';
        };

        let answered = this.questions.filter(q => this.isAnswered(q.id, memberId));
        if (answered.length === 0) {
            let empty = document.createElement('div');
            empty.className = 'wheel-member-detail-empty';
            empty.textContent = member.name + ' hasn\'t answered any questions yet.';
            body.appendChild(empty);
            modal.hidden = false;
            playSound('navigate');
            return;
        }

        let groupOrder = {};
        this.groups.forEach((g, i) => { groupOrder[g.name] = i; });
        let orderIndex = name => (name in groupOrder ? groupOrder[name] : this.groups.length);

        let buckets = {};
        answered.forEach(q => {
            let name = groupNameOf(q);
            (buckets[name] = buckets[name] || []).push(q);
        });
        let groupNames = Object.keys(buckets).sort((a, b) => {
            let oa = orderIndex(a), ob = orderIndex(b);
            return oa !== ob ? oa - ob : a.localeCompare(b);
        });

        let summary = document.createElement('div');
        summary.className = 'wheel-member-detail-summary';
        summary.textContent = answered.length + ' question'
            + (answered.length === 1 ? '' : 's') + ' answered';
        body.appendChild(summary);

        let avgOf = vals => Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 2) / 2;

        groupNames.forEach(name => {
            let qs = buckets[name].slice().sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
            let grpObj = this.groups.find(g => g.name === name);

            let section = document.createElement('div');
            section.className = 'wheel-member-detail-group';

            let head = document.createElement('div');
            head.className = 'wheel-member-detail-group-head';
            let dot = document.createElement('span');
            dot.className = 'wheel-member-detail-dot';
            dot.style.background = (grpObj && typeof grpObj.color === 'string')
                ? grpObj.color : this.colorFor(qs[0]);
            let gname = document.createElement('span');
            gname.className = 'wheel-member-detail-group-name';
            gname.textContent = name;
            let gcount = document.createElement('span');
            gcount.className = 'wheel-member-detail-group-count';
            gcount.textContent = '(' + qs.length + ')';
            head.appendChild(dot);
            head.appendChild(gname);
            if (isScoringEnabled()) {
                let gvals = qs.map(q => getMemberQuestionScore(q.id, memberId)).filter(v => v > 0);
                if (gvals.length > 0) {
                    let gavg = document.createElement('span');
                    gavg.className = 'wheel-member-detail-group-avg';
                    gavg.textContent = '★' + avgOf(gvals);
                    gavg.title = 'Average rating for ' + name;
                    head.appendChild(gavg);
                }
            }
            head.appendChild(gcount);
            section.appendChild(head);

            qs.forEach(q => {
                let row = document.createElement('div');
                row.className = 'wheel-member-detail-row';
                let t = document.createElement('span');
                t.className = 'wheel-member-detail-q';
                t.textContent = titleOf(q);
                row.appendChild(t);
                if (isScoringEnabled()) {
                    let rating = getMemberQuestionScore(q.id, memberId);
                    if (rating > 0) {
                        let r = document.createElement('span');
                        r.className = 'wheel-member-detail-rating';
                        r.textContent = '★' + rating;
                        r.title = rating + ' / 5';
                        row.appendChild(r);
                    }
                }
                section.appendChild(row);
            });
            body.appendChild(section);
        });

        if (isScoringEnabled()) {
            let allVals = answered
                .map(q => getMemberQuestionScore(q.id, memberId))
                .filter(v => v > 0);
            if (allVals.length > 0) {
                let footer = document.createElement('div');
                footer.className = 'wheel-member-detail-footer';
                let label = document.createElement('span');
                label.className = 'wheel-member-detail-footer-label';
                label.textContent = 'Overall average';
                let val = document.createElement('span');
                val.className = 'wheel-member-detail-footer-avg';
                val.textContent = '★' + avgOf(allVals);
                val.title = 'Average across ' + allVals.length + ' rated question'
                    + (allVals.length === 1 ? '' : 's');
                footer.appendChild(label);
                footer.appendChild(val);
                body.appendChild(footer);
            }
        }

        modal.hidden = false;
        playSound('navigate');
    }

    closeMemberDetail() {
        let modal = document.getElementById('wheelMemberDetailModal');
        if (modal) modal.hidden = true;
    }

    // ── Stats modal ───────────────────────────────────────────────────────────

    openStatsModal() {
        let modal = document.getElementById('wheelStatsModal');
        let sel = document.getElementById('wheelStatsSelect');
        if (!modal || !sel) return;

        // Build dropdown: "Global" + one entry per member.
        sel.innerHTML = '';
        let globalOpt = document.createElement('option');
        globalOpt.value = '';
        globalOpt.textContent = 'Global average';
        sel.appendChild(globalOpt);
        this.members.forEach(m => {
            let opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            sel.appendChild(opt);
        });
        sel.value = '';
        sel.onchange = () => this.renderStatsTable(sel.value);

        this.renderStatsTable('');
        modal.hidden = false;
        playSound('navigate');
    }

    renderStatsTable(memberId) {
        let body = document.getElementById('wheelStatsBody');
        if (!body) return;
        body.innerHTML = '';

        let questions = this.questions;
        if (questions.length === 0) {
            let empty = document.createElement('div');
            empty.className = 'wheel-stats-empty';
            empty.textContent = 'No questions loaded.';
            body.appendChild(empty);
            return;
        }

        let titleOf = q => (q.question && q.question.title) || ('Question #' + q.id);
        let groupNameOf = q => {
            let g = this.findGroup(this.questionGroups[q.id]);
            return g ? g.name : 'Ungrouped';
        };

        let groupOrder = {};
        this.groups.forEach((g, i) => { groupOrder[g.name] = i; });
        let orderIndex = name => (name in groupOrder ? groupOrder[name] : this.groups.length);

        let scoreOf = (q) => {
            if (memberId) {
                return getMemberQuestionScore(q.id, memberId);
            }
            let manual = getQuestionScore(q.id);
            return manual > 0 ? manual : getMemberAverageScore(q.id);
        };

        // Only rows with a score > 0.
        let rated = questions.filter(q => scoreOf(q) > 0);

        if (rated.length === 0) {
            let empty = document.createElement('div');
            empty.className = 'wheel-stats-empty';
            empty.textContent = memberId
                ? 'This member hasn\'t rated any questions yet.'
                : 'No ratings yet.';
            body.appendChild(empty);
            return;
        }

        rated.sort((a, b) => {
            let ga = groupNameOf(a), gb = groupNameOf(b);
            let oa = orderIndex(ga), ob = orderIndex(gb);
            if (oa !== ob) return oa - ob;
            if (ga !== gb) return ga.localeCompare(gb);
            return scoreOf(b) - scoreOf(a);
        });

        // Group rows by category.
        let buckets = {};
        rated.forEach(q => {
            let name = groupNameOf(q);
            (buckets[name] = buckets[name] || []).push(q);
        });
        let groupNames = Object.keys(buckets).sort((a, b) => orderIndex(a) - orderIndex(b));

        // Overall average line.
        let allVals = rated.map(scoreOf);
        let overallAvg = Math.round((allVals.reduce((a, b) => a + b, 0) / allVals.length) * 2) / 2;
        let summary = document.createElement('div');
        summary.className = 'wheel-stats-summary';
        summary.textContent = rated.length + ' rated question' + (rated.length === 1 ? '' : 's')
            + ' · overall avg ★' + overallAvg;
        body.appendChild(summary);

        groupNames.forEach(name => {
            let qs = buckets[name];
            let grpObj = this.groups.find(g => g.name === name);

            let section = document.createElement('div');
            section.className = 'wheel-stats-group';

            let head = document.createElement('div');
            head.className = 'wheel-stats-group-head';
            if (grpObj && grpObj.color) {
                let dot = document.createElement('span');
                dot.className = 'wheel-member-detail-dot';
                dot.style.background = grpObj.color;
                head.appendChild(dot);
            }
            let gname = document.createElement('span');
            gname.className = 'wheel-stats-group-name';
            gname.textContent = name;
            head.appendChild(gname);

            let gvals = qs.map(scoreOf);
            let gavg = Math.round((gvals.reduce((a, b) => a + b, 0) / gvals.length) * 2) / 2;
            let gcnt = document.createElement('span');
            gcnt.className = 'wheel-stats-group-avg';
            gcnt.textContent = '★' + gavg;
            head.appendChild(gcnt);
            section.appendChild(head);

            qs.forEach(q => {
                let row = document.createElement('div');
                row.className = 'wheel-stats-row';

                let qtitle = document.createElement('span');
                qtitle.className = 'wheel-stats-q';
                qtitle.textContent = titleOf(q);

                let stars = document.createElement('span');
                stars.className = 'wheel-stats-stars';
                stars.textContent = '★' + scoreOf(q);

                row.appendChild(qtitle);
                row.appendChild(stars);
                section.appendChild(row);
            });

            body.appendChild(section);
        });
    }

    closeStatsModal() {
        let modal = document.getElementById('wheelStatsModal');
        if (modal) modal.hidden = true;
    }

    // Small choice dialog. options is [{ label, desc, fn }]; picking one closes
    // the dialog and runs its fn. Used by the Show/Hide question filters.
    showChoice(title, options) {
        let modal = document.getElementById('wheelChoiceModal');
        let titleEl = document.getElementById('wheelChoiceTitle');
        let optsEl = document.getElementById('wheelChoiceOptions');
        if (!modal || !optsEl) return;

        if (titleEl) titleEl.textContent = title;
        optsEl.innerHTML = '';
        options.forEach(opt => {
            let btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'wheel-choice-option';
            let label = document.createElement('span');
            label.className = 'wheel-choice-option-label';
            label.textContent = opt.label;
            btn.appendChild(label);
            if (opt.desc) {
                let d = document.createElement('span');
                d.className = 'wheel-choice-option-desc';
                d.textContent = opt.desc;
                btn.appendChild(d);
            }
            btn.onclick = () => { this.closeChoice(); opt.fn(); };
            optsEl.appendChild(btn);
        });
        modal.hidden = false;
        playSound('navigate');
    }

    closeChoice() {
        let modal = document.getElementById('wheelChoiceModal');
        if (modal) modal.hidden = true;
    }

    // Members currently in the rotation (disabled ones are sat out).
    activeMembers() {
        return this.members.filter(m => !m.disabled);
    }

    // Bulk visibility helpers driven by member-answered state.
    // Show only questions that aren't fully answered yet (at least one enabled
    // member still hasn't answered them); hide the fully-answered rest.
    showOnlyNotFullyAnswered() {
        if (this.spinning) return;
        if (this.activeMembers().length === 0) return;
        let changed = false;
        this.questions.forEach(q => {
            let full = this.allAnswered(q.id);
            if (full && !this.hidden.has(q.id)) { this.hidden.add(q.id); changed = true; }
            else if (!full && this.hidden.has(q.id)) { this.hidden.delete(q.id); changed = true; }
        });
        if (changed) this.resetSpinner();
        this.render();
        playSound(changed ? 'select' : 'deselect');
    }

    // Hide every question that all enabled members have already answered.
    hideFullyAnsweredQuestions() {
        if (this.spinning) return;
        if (this.activeMembers().length === 0) return;
        let changed = false;
        this.questions.forEach(q => {
            if (!this.hidden.has(q.id) && this.allAnswered(q.id)) {
                this.hidden.add(q.id);
                changed = true;
            }
        });
        if (changed) this.resetSpinner();
        this.render();
        playSound(changed ? 'deselect' : 'select');
    }

    // Hide every question that at least one member has answered.
    hideAnsweredBySomeone() {
        if (this.spinning) return;
        let changed = false;
        this.questions.forEach(q => {
            if (!this.hidden.has(q.id) && this.answeredIds(q.id).length > 0) {
                this.hidden.add(q.id);
                changed = true;
            }
        });
        if (changed) this.resetSpinner();
        this.render();
        playSound(changed ? 'deselect' : 'select');
    }

    // Leave only the questions that nobody has answered yet on the wheel: show
    // those with zero answers and hide every question with at least one answer.
    showOnlyUnansweredByAnyone() {
        if (this.spinning) return;
        let changed = false;
        this.questions.forEach(q => {
            let answeredByAny = this.answeredIds(q.id).length > 0;
            if (answeredByAny && !this.hidden.has(q.id)) {
                this.hidden.add(q.id);
                changed = true;
            } else if (!answeredByAny && this.hidden.has(q.id)) {
                this.hidden.delete(q.id);
                changed = true;
            }
        });
        if (changed) this.resetSpinner();
        this.render();
        playSound(changed ? 'select' : 'deselect');
    }

    unansweredMembers(qid) {
        let done = new Set(this.answeredIds(qid));
        return this.activeMembers().filter(m => !done.has(m.id));
    }

    // A question is complete only when there's at least one active member and
    // none of them are still pending.
    allAnswered(qid) {
        return this.activeMembers().length > 0 && this.unansweredMembers(qid).length === 0;
    }

    // Toggles whether a member has answered the open question. When a row
    // element is passed, the row is updated in place rather than rebuilding the
    // whole list — that keeps the node alive between the two clicks of a
    // double-click (which toggles the enabled state).
    toggleAnswered(memberId, rowEl) {
        if (!this.selected || this.rolling) return;
        let member = this.members.find(m => m.id === memberId);
        // Disabled members can still have their answered state tracked — they
        // just don't gate question completion (which only counts active ones).
        if (!member) return;
        let qid = this.selected.id;
        let list = this.answered[qid] ? this.answered[qid].slice() : [];
        let pos = list.indexOf(memberId);
        let wasAnswered = pos >= 0;
        if (wasAnswered) list.splice(pos, 1);
        else list.push(memberId);
        if (list.length) this.answered[qid] = list;
        else delete this.answered[qid];
        let nowAnswered = !wasAnswered;
        if (this.rolledMemberId === memberId && nowAnswered) this.rolledMemberId = null;

        if (this.maybeCompleteSelected()) return;
        playSound(nowAnswered ? 'select' : 'deselect');
        this.persistState();

        if (rowEl) {
            rowEl.classList.toggle('answered', nowAnswered);
            let check = rowEl.querySelector('.wheel-member-check');
            if (check) {
                check.textContent = nowAnswered ? '✓' : '';
                check.title = nowAnswered ? 'Answered — click to unmark' : 'Mark answered';
            }
            // The 🎲 tag clears once the rolled member is marked answered.
            let tag = rowEl.querySelector('.wheel-member-rolled-tag');
            if (tag && (nowAnswered || this.rolledMemberId !== memberId)) tag.remove();
        } else {
            this.renderMembersPanel();
        }
        this.renderSidebar();
    }

    // When every active member has answered the open question, mark it hidden
    // on the wheel but keep the modal open (the user closes it themselves).
    // Returns true when it handled completion.
    maybeCompleteSelected() {
        if (!this.selected || !this.allAnswered(this.selected.id)) return false;
        let qid = this.selected.id;
        if (!this.hidden.has(qid)) {
            this.hidden.add(qid);
            this.resetSpinner();
        }
        playSound('navigate');
        this.render();
        this.renderMembersPanel();
        return true;
    }

    rollMember() {
        if (!this.selected || this.rolling) return;
        let resultEl = document.getElementById('wheelMembersRollResult');
        let pool = this.unansweredMembers(this.selected.id);
        if (pool.length === 0) {
            this.rolledMemberId = null;
            if (resultEl) {
                resultEl.hidden = false;
                resultEl.textContent = this.members.length === 0
                    ? 'No members to roll.'
                    : 'Everyone has answered.';
            }
            this.renderMembersPanel();
            playSound('deselect');
            return;
        }

        // One candidate — nothing to spin, land immediately.
        if (pool.length === 1) {
            this.landRolledMember(pool[0]);
            playSound('wheel-land');
            return;
        }

        this.animateMemberRoll(pool);
    }

    // Marks the rolled member; the panel row highlight and 🎲 tag are enough to
    // show who was picked, so no separate result banner is shown.
    landRolledMember(member) {
        this.rolledMemberId = member.id;
        this.renderMembersPanel();
    }

    cancelRoll() {
        if (this._rollRaf) { cancelAnimationFrame(this._rollRaf); this._rollRaf = null; }
        this.rolling = false;
        this.clearRollHighlight();
    }

    clearRollHighlight() {
        let list = document.getElementById('wheelMembersPanelList');
        if (list) list.querySelectorAll('.wheel-member-row.rolling')
            .forEach(r => r.classList.remove('rolling'));
    }

    // Picks a random member by sweeping a highlight down the member list —
    // fast at first, then easing to a stop on the winner. The sweep lasts as
    // long as a wheel spin (prefs.spinTimeMs).
    animateMemberRoll(pool) {
        let n = pool.length;
        let prevId = this.rolledMemberId;
        this.rolling = true;
        this.rolledMemberId = null;
        let resultEl = document.getElementById('wheelMembersRollResult');
        if (resultEl) resultEl.hidden = true;
        // Re-render so the Roll button is disabled and rows carry member ids.
        this.renderMembersPanel();

        let list = document.getElementById('wheelMembersPanelList');
        let rowFor = (id) => list
            ? Array.from(list.children).find(r => r.dataset && r.dataset.memberId === id)
            : null;

        // Weighted random pick: every candidate can win, so the result stays
        // unpredictable, but the member picked last time gets a much smaller
        // weight so the roll doesn't keep landing on the same name (and small
        // rosters don't degenerate into a deterministic alternation).
        let weights = pool.map(m => (m.id === prevId ? 0.2 : 1));
        let totalWeight = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * totalWeight;
        let pickedIdx = n - 1;
        for (let i = 0; i < n; i++) {
            r -= weights[i];
            if (r < 0) { pickedIdx = i; break; }
        }
        let picked = pool[pickedIdx];
        // Begin the sweep on a random member rather than always the first one,
        // then run at least three full passes before easing to a stop on the
        // winner. totalSteps is chosen so the final highlight lands on `picked`
        // given the random starting offset.
        let startOffset = Math.floor(Math.random() * n);
        let totalSteps = n * 3 + ((pickedIdx - startOffset + n) % n);
        let duration = Math.max(300, this.prefs.spinTimeMs);
        let startTime = performance.now();
        let lastStep = -1;

        let animate = (now) => {
            if (!this.rolling) { this.clearRollHighlight(); return; }
            let t = Math.min(1, (now - startTime) / duration);
            let step = Math.min(totalSteps, Math.floor(easeOutQuint(t) * (totalSteps + 1)));
            if (step !== lastStep) {
                lastStep = step;
                this.clearRollHighlight();
                let row = rowFor(pool[(step + startOffset) % n].id);
                if (row) row.classList.add('rolling');
                playSound('wheel-tick', 0.5);
            }
            // Land as soon as the highlight reaches the winner — don't sit on it
            // waiting out the flat tail of the easing curve.
            if (step >= totalSteps || t >= 1) {
                this._rollRaf = null;
                this.rolling = false;
                playSound('wheel-land');
                this.landRolledMember(picked);
            } else {
                this._rollRaf = requestAnimationFrame(animate);
            }
        };
        this._rollRaf = requestAnimationFrame(animate);
    }

    applyMembersButton() {
        let btn = document.getElementById('wheelModalMembersBtn');
        if (btn) btn.hidden = !this.prefs.membersEnabled;
    }

    toggleMembersPanel() {
        let panel = document.getElementById('wheelMembersPanel');
        if (!panel) return;
        if (panel.hidden) {
            this.renderMembersPanel();
            panel.hidden = false;
            let side = document.getElementById('wheelModalSide');
            if (side) side.hidden = false;
            playSound('navigate');
        } else {
            this.closeMembersPanel();
        }
    }

    closeMembersPanel() {
        let panel = document.getElementById('wheelMembersPanel');
        if (panel) panel.hidden = true;
        this.applyModalSideVisibility();
    }

    renderMembersPanel() {
        let list = document.getElementById('wheelMembersPanelList');
        let empty = document.getElementById('wheelMembersPanelEmpty');
        let rollBtn = document.getElementById('wheelMembersRollBtn');
        if (!list) return;
        list.innerHTML = '';
        let qid = this.selected ? this.selected.id : null;

        if (this.members.length === 0) {
            if (empty) empty.hidden = false;
            if (rollBtn) rollBtn.disabled = true;
            return;
        }
        if (empty) empty.hidden = true;

        let pending = qid != null ? this.unansweredMembers(qid).length : this.activeMembers().length;
        if (rollBtn) rollBtn.disabled = pending === 0 || this.rolling;

        this.members.forEach(m => {
            let disabled = m.disabled;
            // The ✓ reflects whether they answered, even while disabled.
            let answered = qid != null && this.isAnswered(qid, m.id);
            let row = document.createElement('div');
            row.className = 'wheel-member-row'
                + (disabled ? ' disabled' : '')
                + (answered ? ' answered' : '')
                + (m.id === this.rolledMemberId ? ' rolled' : '');
            row.dataset.memberId = m.id;
            row.title = 'Click to mark answered • double-click to '
                + (disabled ? 'enable' : 'disable');

            // Single click (anywhere but the rating stars) toggles answered;
            // double-click toggles the member's enabled state. The answered
            // toggle updates the row in place so it doesn't rebuild the list
            // mid-gesture, which would stop the double-click from registering.
            row.onclick = () => this.toggleAnswered(m.id, row);
            row.ondblclick = () => this.setMemberDisabled(m.id, !m.disabled);

            let check = document.createElement('span');
            check.className = 'wheel-member-check';
            check.textContent = answered ? '✓' : '';
            check.title = answered ? 'Answered — click to unmark' : 'Mark answered';
            // A double-click on the box shouldn't toggle the enabled state.
            check.ondblclick = (e) => e.stopPropagation();

            let name = document.createElement('span');
            name.className = 'wheel-member-name';
            name.textContent = m.name;

            row.appendChild(check);
            row.appendChild(name);

            if (!disabled && m.id === this.rolledMemberId && !answered) {
                let tag = document.createElement('span');
                tag.className = 'wheel-member-rolled-tag';
                tag.textContent = '🎲';
                row.appendChild(tag);
            }

            // Each member rates how hard the current question was; the average
            // feeds the question's overall rating.
            if (qid != null && isScoringEnabled()) {
                row.appendChild(buildMemberStarWidget(qid, m.id, () => {
                    this.refreshModalScore();
                    this.renderSidebar();
                }));
            }

            list.appendChild(row);
        });
    }

    shuffleWheel() {
        if (this.spinning) return;
        shuffle(this.wheelOrder);
        this.resetSpinner();
        this.renderWheel();
        this.updateSpinButton();
        this.persistState();
        playSound('wheel-shuffle');
    }

    toggleAllQuestions() {
        if (this.spinning) return;
        if (this.questions.length === 0) return;
        let anyVisible = this.questions.some(q => !this.hidden.has(q.id));
        if (anyVisible) {
            this.questions.forEach(q => this.hidden.add(q.id));
        } else {
            this.hidden.clear();
        }
        this.resetSpinner();
        this.render();
        playSound(anyVisible ? 'deselect' : 'select');
    }

    updateShowAllBtn() {
        let btn = document.getElementById('wheelShowAllBtn');
        if (!btn) return;
        let anyVisible = this.questions.some(q => !this.hidden.has(q.id));
        btn.textContent = anyVisible ? '⦸' : '⟳';
        btn.title = anyVisible ? 'Hide all questions' : 'Show all questions';
    }

    applySize() {
        let view = document.getElementById('wheelView');
        if (view) view.style.setProperty('--wheel-scale', (this.prefs.size / 100).toString());
    }

    applyTextScale() {
        // text scale is read directly by renderWheel via this.prefs.textScale
    }

    applyHubSize() {
        let view = document.getElementById('wheelView');
        if (view) view.style.setProperty('--wheel-hub-size', this.prefs.hubSize + '%');
    }

    isMobile() {
        return window.innerWidth <= 600;
    }

    applyCentered() {
        let view = document.getElementById('wheelView');
        if (view) view.classList.toggle('wheel-centered', !this.isMobile() && this.prefs.centered);
    }

    applyTimerVisibility() {
        let on = this.prefs.timerEnabled;
        let box = document.getElementById('wheelModalTimerBox');
        if (box) box.hidden = !on;
        let globalBox = document.getElementById('wheelGlobalTimerBox');
        if (globalBox) globalBox.hidden = !on;
        // The small in-question secondary readout only makes sense in
        // continuous mode (otherwise it would just mirror the main timer).
        let inq = document.getElementById('wheelGlobalInQuestion');
        if (inq) inq.hidden = !(on && this.prefs.timerContinuous);
        this.applyModalSideVisibility();
        // In continuous mode the global timer keeps ticking; in in-question
        // mode it only ticks while a question is open.
        this.initTimers();
        if (on && this.prefs.timerContinuous && !this.global.paused) {
            this.swStart(this.global);
            this.ensureTimerLoop();
        } else if (on && !this.prefs.timerContinuous && !this.selected) {
            this.swStop(this.global);
        }
        this.renderTimers();
        this.stopTimerLoopIfIdle();
    }

    applyModalSideVisibility() {
        let side = document.getElementById('wheelModalSide');
        if (!side) return;
        let timerOn = this.prefs.timerEnabled;
        let panel = document.getElementById('wheelMembersPanel');
        let membersOpen = panel ? !panel.hidden : false;
        side.hidden = !(timerOn || membersOpen);
    }

    // ── Timers ────────────────────────────────────────────────────────────────
    // Two independent stopwatches: a global one (total time spent in questions)
    // and a per-question one (resets on each question open). Each ticks while
    // its `runSince` is non-null and stops while paused or while no question
    // is open. The global timer also stops when its own pause is engaged.

    initTimers() {
        this.global = this.global || { elapsed: 0, runSince: null, paused: false };
        this.question = this.question || { elapsed: 0, runSince: null, paused: false };
        this.inQuestion = this.inQuestion || { elapsed: 0, runSince: null, paused: false };
    }

    stopwatchValue(s) {
        return s.elapsed + (s.runSince != null ? Date.now() - s.runSince : 0);
    }

    formatTime(ms) {
        let s = Math.floor(ms / 1000);
        let m = Math.floor(s / 60);
        let h = Math.floor(m / 60);
        return (h > 0 ? String(h).padStart(2, '0') + ' : ' : '')
            + String(m % 60).padStart(2, '0') + ' : '
            + String(s % 60).padStart(2, '0');
    }

    swStart(s) { if (s.runSince == null && !s.paused) s.runSince = Date.now(); }
    swStop(s) { if (s.runSince != null) { s.elapsed += Date.now() - s.runSince; s.runSince = null; } }
    swTogglePause(s) {
        if (s.paused) { s.paused = false; this.swStart(s); }
        else { this.swStop(s); s.paused = true; }
    }
    swReset(s) { s.elapsed = 0; if (s.runSince != null) s.runSince = Date.now(); }

    renderTimers() {
        this.initTimers();
        let gEl = document.getElementById('wheelGlobalTimer');
        if (gEl) gEl.innerText = this.formatTime(this.stopwatchValue(this.global));
        let qEl = document.getElementById('wheelModalTimer');
        if (qEl) qEl.innerText = this.formatTime(this.stopwatchValue(this.question));
        let inqEl = document.getElementById('wheelGlobalInQuestionValue');
        if (inqEl) inqEl.innerText = this.formatTime(this.stopwatchValue(this.inQuestion));

        let gBtn = document.getElementById('wheelGlobalPauseBtn');
        if (gBtn) gBtn.innerText = this.global.paused ? '▶' : '⏸';
        let gTimer = document.getElementById('wheelGlobalTimer');
        if (gTimer) gTimer.classList.toggle('paused', this.global.paused);

        let qBtn = document.getElementById('wheelModalTimerPauseBtn');
        if (qBtn) qBtn.innerText = this.question.paused ? '▶' : '⏸';
        let qTimer = document.getElementById('wheelModalTimer');
        if (qTimer) qTimer.classList.toggle('paused', this.question.paused);
    }

    ensureTimerLoop() {
        if (this.timerInterval) return;
        let tick = () => this.renderTimers();
        tick();
        this.timerInterval = setInterval(tick, 500);
    }

    stopTimerLoopIfIdle() {
        // Keep the loop while any stopwatch is actively running.
        if (this.global.runSince != null
            || this.question.runSince != null
            || this.inQuestion.runSince != null) return;
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = null;
    }

    // Called when a question modal opens. Resets the question timer; starts
    // the per-question and in-question stopwatches. In 'in-question' mode
    // the global also starts now (in continuous mode it's already running).
    startTimer() {
        this.initTimers();
        if (!this.prefs.timerEnabled) return;
        this.question.elapsed = 0;
        this.question.runSince = null;
        this.question.paused = false;
        this.swStart(this.question);
        this.swStart(this.inQuestion);
        this.swStart(this.global);
        this.ensureTimerLoop();
        this.renderTimers();
    }

    // Called when the question modal closes.
    stopTimer() {
        this.initTimers();
        this.swStop(this.question);
        this.swStop(this.inQuestion);
        // The continuous global timer keeps ticking once no question is open;
        // the in-question one stops with the modal.
        if (!this.prefs.timerContinuous) this.swStop(this.global);
        this.renderTimers();
        this.stopTimerLoopIfIdle();
    }

    toggleGlobalPause() {
        this.initTimers();
        this.swTogglePause(this.global);
        playSound('pause');
        this.renderTimers();
        this.stopTimerLoopIfIdle();
    }

    toggleQuestionPause() {
        this.initTimers();
        this.swTogglePause(this.question);
        playSound('pause');
        this.renderTimers();
        this.stopTimerLoopIfIdle();
    }

    resetQuestionTimer() {
        this.initTimers();
        this.swReset(this.question);
        playSound('navigate');
        this.renderTimers();
    }

    updateHubSizeLabel() {
        let el = document.getElementById('wheelHubSizeValue');
        if (el && document.activeElement !== el) el.value = this.prefs.hubSize + '%';
    }

    updateSizeLabel() {
        let el = document.getElementById('wheelSizeValue');
        if (el && document.activeElement !== el) el.value = this.prefs.size + '%';
    }

    updateTextLabel() {
        let el = document.getElementById('wheelTextSizeValue');
        if (el && document.activeElement !== el) el.value = this.prefs.textScale + '%';
    }

    updateSpinTimeLabel() {
        let el = document.getElementById('wheelSpinTimeValue');
        if (el && document.activeElement !== el) el.value = (this.prefs.spinTimeMs / 1000).toFixed(2).replace(/\.?0+$/, '') + 's';
    }

    render() {
        this.renderWheel();
        this.renderSidebar();
        this.updateSpinButton();
        this.updateShowAllBtn();
        this.persistState();
    }

    updateSpinButton() {
        let hub = document.getElementById('wheelHub');
        if (!hub) return;
        let n = this.active.length;
        let disabled = this.spinning || n === 0;
        hub.style.opacity = disabled ? '0.45' : '';
        hub.style.cursor = disabled ? 'not-allowed' : '';
        hub.textContent = this.spinning ? '…' : 'SPIN';
    }

    renderWheel() {
        let svg = document.getElementById('wheelSvg');
        let size = 600;
        let cx = size / 2;
        let cy = size / 2;
        let radius = size / 2 - 8;
        let active = this.active;
        let n = active.length;

        while (svg.firstChild) svg.removeChild(svg.firstChild);

        if (n === 0) {
            let msg = document.createElementNS(WHEEL_SVG_NS, 'text');
            msg.setAttribute('x', cx);
            msg.setAttribute('y', cy);
            msg.setAttribute('text-anchor', 'middle');
            msg.setAttribute('dominant-baseline', 'middle');
            msg.setAttribute('fill', '#555');
            msg.setAttribute('font-size', '26');
            msg.textContent = 'No questions';
            svg.appendChild(msg);
            return;
        }

        if (n === 1) {
            let circ = document.createElementNS(WHEEL_SVG_NS, 'circle');
            circ.setAttribute('cx', cx);
            circ.setAttribute('cy', cy);
            circ.setAttribute('r', radius);
            circ.setAttribute('fill', this.colorFor(active[0]));
            circ.setAttribute('stroke', '#1a1a1a');
            circ.setAttribute('stroke-width', '3');
            svg.appendChild(circ);
            this.appendSectorText(svg, active[0], cx, cy, radius, -90, 360);
            return;
        }

        let step = 360 / n;
        for (let i = 0; i < n; i++) {
            let startAngle = i * step - 90;
            let endAngle = startAngle + step;
            let path = this.makeSectorPath(cx, cy, radius, startAngle, endAngle);
            let sector = document.createElementNS(WHEEL_SVG_NS, 'path');
            sector.setAttribute('d', path);
            sector.setAttribute('fill', this.colorFor(active[i]));
            sector.setAttribute('stroke', '#1a1a1a');
            sector.setAttribute('stroke-width', '2');
            svg.appendChild(sector);

            let midAngle = startAngle + step / 2;
            this.appendSectorText(svg, active[i], cx, cy, radius, midAngle, step);
        }
    }

    findGroup(ref) {
        if (ref === undefined || ref === null || ref === '') return null;
        return this.groups.find(g => g.id === ref || g.name === ref) || null;
    }

    colorFor(q) {
        if (q && this.questionGroups) {
            let ref = this.questionGroups[q.id];
            let grp = this.findGroup(ref);
            if (grp && typeof grp.color === 'string') return grp.color;
            // A raw hex color in the "group" field means "no group, just
            // this color" — the sidebar will bucket it as ungrouped.
            if (typeof ref === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(ref)) return ref;
        }
        let c = q && q.question && q.question.color;
        if (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
        return WHEEL_DEFAULT_COLOR;
    }

    makeSectorPath(cx, cy, r, startAngle, endAngle) {
        let start = polarToCartesian(cx, cy, r, startAngle);
        let end = polarToCartesian(cx, cy, r, endAngle);
        let largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
        return [
            'M', cx, cy,
            'L', start.x, start.y,
            'A', r, r, 0, largeArc, 1, end.x, end.y,
            'Z'
        ].join(' ');
    }

    appendSectorText(svg, q, cx, cy, radius, midAngle, step) {
        let title = (q.question && q.question.title) || ('Question #' + q.id);
        let textScale = this.prefs.textScale / 100;
        let textOuter = this.prefs.textOuter;
        let dynamic = this.prefs.dynamicRotation;

        // Hub radius in svg coords. The hub div is sized as a percentage of
        // the wheel diameter (= 2 * cx); its radius is half of that.
        let hubRadius = (this.prefs.hubSize / 100) * cx;
        // Real padding so labels don't kiss the hub or the rim.
        let pad = cx * 0.05;
        let innerR = hubRadius + pad;
        let outerR = radius - pad;
        if (outerR < innerR + 10) outerR = innerR + 10; // degenerate safety
        let availLen = outerR - innerR;

        // Flip decision.
        // Auto-rotate OFF: always flip so every label consistently reads
        // outer → inner in the sector's local frame (no conditional on angle).
        // Auto-rotate ON: flip based on absolute screen-space angle so labels
        // stay upright after a spin.
        let flipped;
        if (dynamic) {
            let effAngle = midAngle + (this.rotation || 0);
            effAngle = ((effAngle + 180) % 360 + 360) % 360 - 180;
            flipped = effAngle > 90 || effAngle < -90;
        } else {
            flipped = true;
        }

        // Position: centered (midpoint of the radial range) or anchored at
        // the outer rim with the text extending inward.
        let textRadius = textOuter ? outerR : (innerR + outerR) / 2;
        let pos = polarToCartesian(cx, cy, textRadius, midAngle);

        // Maximum readable font height for this sector — the text is laid out
        // radially, so its "height" after rotation is bounded by the angular
        // width of the sector at textRadius. The 0.78 factor leaves a tiny gap
        // between neighbouring labels. Use midpoint for the constraint even
        // when outer-aligned, since long labels extend inward into the narrower
        // part of the sector.
        let angularLimit = ((innerR + outerR) / 2) * (step * Math.PI / 180) * 0.78;
        let baseFontSize = Math.min(angularLimit, 22);
        let fontSize = Math.max(6, baseFontSize * textScale);

        // text-anchor: when centered we use 'middle'. When outer-aligned the
        // text should always extend from the rim toward the centre — which
        // direction "inward" is in the text's local frame depends on flip.
        let anchor;
        if (textOuter) anchor = flipped ? 'start' : 'end';
        else anchor = 'middle';

        let txt = document.createElementNS(WHEEL_SVG_NS, 'text');
        txt.setAttribute('x', pos.x);
        txt.setAttribute('y', pos.y);
        txt.setAttribute('text-anchor', anchor);
        txt.setAttribute('dominant-baseline', 'middle');
        txt.setAttribute('fill', '#ffffff');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('font-size', fontSize);
        txt.setAttribute('paint-order', 'stroke');
        txt.setAttribute('stroke', 'rgba(0,0,0,0.55)');
        txt.setAttribute('stroke-width', Math.max(1, fontSize * 0.1));
        txt.setAttribute('stroke-linejoin', 'round');

        let rotation = midAngle + (flipped ? 180 : 0);
        txt.setAttribute('transform', 'rotate(' + rotation + ' ' + pos.x + ' ' + pos.y + ')');
        txt.style.pointerEvents = 'none';
        txt.textContent = title;
        svg.appendChild(txt);

        // Truncate to whatever naturally fits the radial space and add "…".
        // No glyph squeezing or letter-spacing changes — text renders at its
        // natural width and gets shorter when it doesn't fit.
        try {
            if (txt.getBBox().width > availLen) {
                let lo = 0, hi = title.length - 1, best = 0;
                while (lo <= hi) {
                    let mid = (lo + hi) >> 1;
                    txt.textContent = title.substring(0, mid) + '…';
                    if (txt.getBBox().width <= availLen) {
                        best = mid;
                        lo = mid + 1;
                    } else {
                        hi = mid - 1;
                    }
                }
                txt.textContent = best === 0 ? '…' : title.substring(0, best) + '…';
            }
        } catch (e) {}
    }

    renderSidebar() {
        this.persistState();
        let list = document.getElementById('wheelQuestionList');
        list.innerHTML = '';
        let q = this.searchQuery;

        let matchesQuery = (question) => {
            if (!q) return true;
            let title = (question.question && question.question.title) || ('Question #' + question.id);
            return title.toLowerCase().includes(q);
        };

        let useGroups = this.groups.length > 0
            && this.questions.some(qq => this.findGroup(this.questionGroups[qq.id]));

        if (useGroups) {
            // Buckets are keyed by group name (guaranteed unique-ish) so we
            // can iterate this.groups in declared order while still matching
            // questions that referenced their group by id.
            let buckets = {};
            this.groups.forEach(g => { buckets[g.name] = []; });
            let ungrouped = [];

            this.questions.forEach(question => {
                if (!matchesQuery(question)) return;
                let group = this.findGroup(this.questionGroups[question.id]);
                if (group) buckets[group.name].push(question);
                else ungrouped.push(question);
            });

            let makeHeader = (key, name, color, items, sortFn) => {
                let allHidden = items.every(q => this.hidden.has(q.id));
                let collapsed = this.collapsedGroups.has(key);
                let header = document.createElement('div');
                header.className = 'wheel-group-header' + (collapsed ? ' collapsed' : '');
                header.style.borderLeftColor = color;

                let collapseBtn = document.createElement('button');
                collapseBtn.className = 'wheel-group-collapse-btn';
                collapseBtn.innerHTML = collapsed
                    ? '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M4 2 L8 6 L4 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                    : '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                collapseBtn.title = collapsed ? 'Expand group' : 'Collapse group';

                let label = document.createElement('span');
                label.className = 'wheel-group-header-label';
                label.textContent = name;

                let toggleCollapse = (e) => {
                    e.stopPropagation();
                    if (collapsed) this.collapsedGroups.delete(key);
                    else this.collapsedGroups.add(key);
                    this.renderSidebar();
                    playSound(collapsed ? 'select' : 'deselect');
                };
                collapseBtn.onclick = toggleCollapse;
                label.onclick = toggleCollapse;
                header.style.cursor = 'pointer';

                header.appendChild(collapseBtn);
                header.appendChild(label);

                let toggleBtn = document.createElement('button');
                toggleBtn.className = 'wheel-group-toggle-btn';
                toggleBtn.innerHTML = allHidden
                    ? '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 8 C3.5 4, 6 2.5, 8 2.5 C10 2.5, 12.5 4, 14.5 8 C12.5 12, 10 13.5, 8 13.5 C6 13.5, 3.5 12, 1.5 8 Z" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
                    : '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 8 C3.5 4, 6 2.5, 8 2.5 C10 2.5, 12.5 4, 14.5 8 C12.5 12, 10 13.5, 8 13.5 C6 13.5, 3.5 12, 1.5 8 Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>';
                toggleBtn.title = allHidden ? 'Show group' : 'Hide group';
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (allHidden) items.forEach(q => this.hidden.delete(q.id));
                    else items.forEach(q => this.hidden.add(q.id));
                    this.resetSpinner();
                    this.render();
                    playSound(allHidden ? 'select' : 'deselect');
                };

                let shownCount = items.reduce((n, q) => n + (this.hidden.has(q.id) ? 0 : 1), 0);
                let count = document.createElement('span');
                count.className = 'wheel-group-count';
                count.textContent = shownCount + '/' + items.length;
                count.title = shownCount + ' shown, ' + (items.length - shownCount) + ' hidden';
                header.appendChild(count);

                header.appendChild(toggleBtn);
                list.appendChild(header);

                if (!collapsed) {
                    items.sort(sortFn);
                    items.forEach(question => list.appendChild(this.makeSidebarItem(question)));
                }
            };

            this.groups.forEach(g => {
                let items = buckets[g.name];
                if (!items || items.length === 0) return;
                makeHeader(g.name, g.name, g.color, items, (a, b) => (a.id ?? 0) - (b.id ?? 0));
            });

            if (ungrouped.length > 0) {
                makeHeader('__ungrouped__', 'Ungrouped', '#555', ungrouped, (a, b) => {
                    let ha = hexToHue(this.colorFor(a));
                    let hb = hexToHue(this.colorFor(b));
                    if (ha !== hb) return ha - hb;
                    return (a.id ?? 0) - (b.id ?? 0);
                });
            }
            return;
        }

        // Default: sort by hue so same-color questions are next to each
        // other, then by id for stability within a color group.
        let sorted = this.questions.slice().sort((a, b) => {
            let ha = hexToHue(this.colorFor(a));
            let hb = hexToHue(this.colorFor(b));
            if (ha !== hb) return ha - hb;
            return (a.id ?? 0) - (b.id ?? 0);
        });

        sorted.forEach(question => {
            if (!matchesQuery(question)) return;
            list.appendChild(this.makeSidebarItem(question));
        });
    }

    makeSidebarItem(question) {
        let title = (question.question && question.question.title) || ('Question #' + question.id);
        let isHidden = this.hidden.has(question.id);
        let item = document.createElement('div');
        item.className = 'wheel-question-item' + (isHidden ? ' off' : '');
        item.onclick = () => this.toggleQuestion(question.id);

        // The colored dot doubles as the "open" control: it shows the
        // question's category color at rest and turns into an eye on hover.
        // Clicking it opens the question as if it was picked.
        let dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'wheel-question-color';
        dot.style.setProperty('--q-color', this.colorFor(question));
        dot.title = 'Open question';
        dot.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>";
        dot.onclick = (e) => {
            e.stopPropagation();
            if (this.spinning) return;
            playSound('select');
            this.showQuestionModal(question);
        };

        let titleEl = document.createElement('span');
        titleEl.className = 'wheel-question-title';
        titleEl.textContent = title;

        let toggle = document.createElement('span');
        toggle.className = 'wheel-question-toggle';
        toggle.textContent = isHidden ? '✕' : '✓';

        item.appendChild(dot);
        item.appendChild(titleEl);

        if (isScoringEnabled()) {
            let manual = getQuestionScore(question.id);
            let score = manual > 0 ? manual : getMemberAverageScore(question.id);
            if (score > 0) {
                let badge = document.createElement('span');
                badge.className = 'wheel-question-score' + (manual > 0 ? '' : ' is-average');
                badge.textContent = '★' + score;
                badge.title = manual > 0
                    ? score + ' / 5 (manual)'
                    : score + ' / 5 (average of ' + getMemberScoreCount(question.id) + ' members)';
                item.appendChild(badge);
            }
        }

        if (this.prefs.membersEnabled) {
            let active = this.activeMembers();
            if (active.length > 0) {
                let answeredCount = active.reduce((n, m) => n + (this.isAnswered(question.id, m.id) ? 1 : 0), 0);
                let badge = document.createElement('span');
                badge.className = 'wheel-member-progress'
                    + (answeredCount >= active.length ? ' complete' : '');
                badge.textContent = answeredCount + '/' + active.length;
                badge.title = answeredCount + ' of ' + active.length + ' active members answered';
                item.appendChild(badge);
            }
        }

        item.appendChild(toggle);

        // Hover tooltip shows the long question text (the title in the row
        // is already the short label). Image-only questions get no tooltip
        // since there's no text to render.
        let qData = question.question;
        if (qData && qData.type === 'text' && typeof qData.content === 'string' && qData.content.trim()) {
            setupTooltip(item, qData.content);
        }

        return item;
    }

    toggleQuestion(id) {
        if (this.spinning) return;
        let wasHidden = this.hidden.has(id);
        if (wasHidden) {
            this.hidden.delete(id);
        } else {
            this.hidden.add(id);
        }
        this.resetSpinner();
        this.render();
        // Show = select, hide = deselect — reuse prompter UI sounds.
        playSound(wasHidden ? 'select' : 'deselect');
    }

    resetSpinner() {
        this.rotation = 0;
        let spinner = document.getElementById('wheelSpinner');
        spinner.style.transition = 'none';
        spinner.style.transform = 'rotate(0deg)';
        void spinner.offsetWidth;
    }

    spin() {
        if (this.spinning) return;
        let active = this.active;
        if (active.length === 0) return;

        this.spinning = true;
        this.updateSpinButton();

        let n = active.length;
        let step = 360 / n;
        let pickedIdx = Math.floor(Math.random() * n);
        let picked = active[pickedIdx];

        let midAngle = pickedIdx * step - 90 + step / 2;
        let randomOffset = (Math.random() - 0.5) * step * 0.7;
        let targetMod = -90 - midAngle + randomOffset;
        let normalize = (a) => ((a % 360) + 360) % 360;
        let currentMod = normalize(this.rotation);
        let targetNorm = normalize(targetMod);
        let delta = targetNorm - currentMod;
        if (delta < 0) delta += 360;
        let fullSpins = 5;
        let totalDelta = delta + 360 * fullSpins;
        let startRotation = this.rotation;
        let endRotation = startRotation + totalDelta;
        this.rotation = endRotation;

        let spinner = document.getElementById('wheelSpinner');
        spinner.style.transition = 'none';

        let startTime = performance.now();
        let duration = this.prefs.spinTimeMs;
        // One tick per section passed. Scale volume by per-section speed: at
        // the start (fast) most ticks are quiet so it doesn't machine-gun,
        // by the time the wheel is crawling each section gets a full tick.
        let lastTickSection = 0;
        let lastTickTime = startTime;

        let animate = (now) => {
            let elapsed = now - startTime;
            let t = Math.min(1, elapsed / duration);
            let eased = easeOutQuint(t);
            let currentRot = startRotation + totalDelta * eased;
            spinner.style.transform = 'rotate(' + currentRot + 'deg)';

            let passed = Math.floor((currentRot - startRotation) / step);
            while (lastTickSection < passed) {
                lastTickSection++;
                let dt = now - lastTickTime;
                lastTickTime = now;
                // dt < ~30ms feels like a buzz; ramp volume from 0.15 at
                // 20ms+ between ticks up to 1.0 at 100ms+.
                let vol = Math.max(0.15, Math.min(1, (dt - 20) / 80));
                playSound('wheel-tick', vol);
            }

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this.spinning = false;
                this.updateSpinButton();
                playSound('wheel-land');
                if (this.prefs.dynamicRotation) this.renderWheel();
                this.showQuestionModal(picked);
            }
        };
        requestAnimationFrame(animate);
    }

    showQuestionModal(question) {
        this.selected = question;
        this.hintRevealed = false;
        this.cancelRoll();
        this.rolledMemberId = null;

        let modal = document.getElementById('wheelModal');
        let body = document.getElementById('wheelModalBody');
        let colorBar = document.getElementById('wheelModalColorBar');
        body.innerHTML = '';
        colorBar.style.background = this.colorFor(question);

        let titleEl = document.createElement('div');
        titleEl.className = 'wheel-modal-title';
        let baseTitle = (question.question && question.question.title) || ('Question #' + question.id);
        let group = this.findGroup(this.questionGroups[question.id]);
        titleEl.textContent = group ? (group.name + ' • ' + baseTitle) : baseTitle;
        body.appendChild(titleEl);

        let contentEl = document.createElement('div');
        contentEl.className = 'wheel-modal-content';
        let qContentType = (question.question && question.question.type) || 'text';
        let qContent = (question.question && question.question.content) || '';
        if (qContentType === 'image') {
            let img = document.createElement('img');
            img.src = qContent;
            img.alt = titleEl.textContent;
            contentEl.appendChild(img);
        } else {
            contentEl.textContent = qContent;
        }
        body.appendChild(contentEl);

        if (Array.isArray(question.answers) && question.answers.length > 0) {
            let hintsHeader = document.createElement('div');
            hintsHeader.className = 'wheel-modal-answers-header';
            hintsHeader.textContent = 'Hints';
            body.appendChild(hintsHeader);

            let list = document.createElement('div');
            list.className = 'wheel-modal-answers';
            question.answers.forEach(a => {
                let row = document.createElement('div');
                row.className = 'wheel-modal-answer';
                let content = typeof a === 'string' ? a : (a && a.content) || '';
                let mdEl = document.createElement('zero-md');
                mdEl.setAttribute('src', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
                let tpl = document.createElement('template');
                tpl.innerHTML = '<link rel="stylesheet" href="css/md.css?v=6">'
                    + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/PrismJS/prism@1/themes/prism.min.css"/>'
                    + '<style>'
                    + '.markdown-body{font-size:0.78rem!important}'
                    + '.markdown-body p{font-size:0.78rem!important;font-weight:normal!important;margin:0.15rem 0}'
                    + '.markdown-body ul,.markdown-body ol,.markdown-body li{font-size:0.78rem!important}'
                    + '.markdown-body h1,.markdown-body h2,.markdown-body h3{font-size:0.9rem!important}'
                    + '.markdown-body code{font-size:0.72rem!important}'
                    + 'p{font-size:0.78rem!important;font-weight:normal!important}'
                    + '</style>';
                mdEl.appendChild(tpl);
                row.appendChild(mdEl);
                list.appendChild(row);
            });
            body.appendChild(list);
        }

        this.applyHintsButton();
        this.refreshModalScore();

        let rollResult = document.getElementById('wheelMembersRollResult');
        if (rollResult) { rollResult.hidden = true; rollResult.textContent = ''; }
        this.applyMembersButton();
        // With the feature on, the roster is shown by default in the question
        // view; otherwise the panel stays closed.
        let membersPanel = document.getElementById('wheelMembersPanel');
        if (membersPanel) membersPanel.hidden = !this.prefs.membersEnabled;
        this.renderMembersPanel();

        // Show side panel if timer or members are active.
        let side = document.getElementById('wheelModalSide');
        if (side) side.hidden = !(this.prefs.timerEnabled || this.prefs.membersEnabled);
        let timerBox = document.getElementById('wheelModalTimerBox');
        if (timerBox) timerBox.hidden = !this.prefs.timerEnabled;

        modal.hidden = false;
        this.startTimer();
    }

    // Adds (or removes) the 1-5 star self-rating row in the open modal,
    // reflecting the current feature toggle. Rating changes refresh the
    // sidebar so its score badge stays in sync.
    refreshModalScore() {
        let body = document.getElementById('wheelModalBody');
        if (!body) return;
        let existing = body.querySelector('.wheel-modal-score');
        if (existing) existing.remove();
        if (!isScoringEnabled() || !this.selected) return;
        let wrap = document.createElement('div');
        wrap.className = 'score-row wheel-modal-score';
        populateScoreWidget(wrap, this.selected.id, () => this.renderSidebar());
        body.appendChild(wrap);
    }

    applyHintsButton() {
        // Hints are hidden by default and only revealed on demand.
        // The "Show hint" button is only visible if hints are enabled in
        // prefs and the current question has any.
        let hasHints = this.selected
            && Array.isArray(this.selected.answers)
            && this.selected.answers.length > 0;

        let btn = document.getElementById('wheelModalShowHint');
        let header = document.querySelector('#wheelModalBody .wheel-modal-answers-header');
        let list = document.querySelector('#wheelModalBody .wheel-modal-answers');

        // The button is hidden only when hints are turned off globally. With
        // hints on but none for this question, it stays visible but disabled
        // and reads "No hint".
        if (!this.prefs.showHints) {
            btn.hidden = true;
            if (header) header.style.display = 'none';
            if (list) list.style.display = 'none';
            return;
        }

        btn.hidden = false;

        if (!hasHints) {
            btn.disabled = true;
            btn.textContent = 'No hint';
            if (header) header.style.display = 'none';
            if (list) list.style.display = 'none';
            return;
        }

        btn.disabled = false;
        if (this.hintRevealed) {
            btn.textContent = 'Hide hint';
            if (header) header.style.display = '';
            if (list) list.style.display = '';
        } else {
            btn.textContent = 'Show hint';
            if (header) header.style.display = 'none';
            if (list) list.style.display = 'none';
        }
    }

    toggleHintReveal() {
        if (!this.prefs.showHints) return;
        this.hintRevealed = !this.hintRevealed;
        this.applyHintsButton();
        if (this.hintRevealed) playSound('show');
    }

    closeModal() {
        document.getElementById('wheelModal').hidden = true;
        this.cancelRoll();
        this.closeMembersPanel();
        this.selected = null;
        this.hintRevealed = false;
        this.rolledMemberId = null;
        this.stopTimer();
    }

    hideSelected() {
        if (!this.selected) {
            this.closeModal();
            return;
        }
        this.hidden.add(this.selected.id);
        let isLast = this.active.length === 0;
        this.closeModal();
        this.resetSpinner();
        if (isLast) {
            // Completed: drop the saved state so a fresh load starts with the
            // full wheel rather than an empty one.
            clearWheelState(this.stateName);
            playSound('finish');
            document.getElementById('wheelView').hidden = true;
            document.body.style.overflow = '';
            showEndscreen('Congratulations!', 'You have answered all questions!');
            // Restart in wheel mode means "go back to the wheel with every
            // question visible again" — no full reload.
            let restartBtn = document.getElementById('restartButton');
            if (restartBtn) {
                restartBtn.onclick = () => {
                    document.getElementById('endScreen').hidden = true;
                    this.hidden.clear();
                    document.getElementById('wheelView').hidden = false;
                    document.body.style.overflow = 'hidden';
                    this.resetSpinner();
                    this.render();
                };
            }
            return;
        }
        this.render();
    }
}

function polarToCartesian(cx, cy, r, angleDeg) {
    let a = angleDeg * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function hexToHue(hex) {
    if (typeof hex !== 'string') return 0;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length === 4) c = c.slice(0,3).split('').map(x => x + x).join('');
    if (c.length === 8) c = c.slice(0, 6);
    if (c.length !== 6) return 0;
    let r = parseInt(c.slice(0,2), 16) / 255;
    let g = parseInt(c.slice(2,4), 16) / 255;
    let b = parseInt(c.slice(4,6), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return -1; // grayscale → keep first
    let h;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h *= 60;
    if (h < 0) h += 360;
    return h;
}
