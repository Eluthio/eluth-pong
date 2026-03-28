<template>
    <div class="pong-wrap" ref="wrapRef">
        <!-- Trigger button -->
        <button
            class="pong-btn"
            :class="{ active: open || !!activeRoom }"
            @click.stop="toggle"
            title="Pong"
        >🏓</button>

        <!-- Active game badge -->
        <span v-if="activeRoom && activeRoom.status !== 'finished'" class="pong-badge">
            {{ activeRoom.status === 'waiting' ? '…' : '▶' }}
        </span>

        <!-- Config panel -->
        <Teleport to="body">
            <div v-if="open" class="pong-config" :style="configStyle" @click.stop>
                <div class="pong-config-header">
                    <span>🏓 Pong</span>
                    <button class="pong-config-close" @click="open = false">✕</button>
                </div>

                <template v-if="activeRoom && activeRoom.status !== 'finished'">
                    <div class="pong-config-active">
                        <p>A game is already in progress.</p>
                        <button class="pong-config-btn" @click="openGame">Open Game</button>
                    </div>
                </template>

                <template v-else>
                    <div class="pong-config-row">
                        <label>First to</label>
                        <div class="pong-score-picker">
                            <button
                                v-for="n in [3, 5, 7, 10]"
                                :key="n"
                                :class="['pong-score-opt', { active: config.scoreLimit === n }]"
                                @click="config.scoreLimit = n"
                            >{{ n }}</button>
                        </div>
                    </div>

                    <div class="pong-config-row">
                        <label>Your paddle</label>
                        <div class="pong-color-row">
                            <button
                                v-for="c in COLORS"
                                :key="c.value"
                                class="pong-color-swatch"
                                :style="{ background: c.value, outline: config.p1Color === c.value ? '2px solid #fff' : 'none' }"
                                :title="c.label"
                                @click="config.p1Color = c.value"
                            />
                        </div>
                    </div>

                    <div class="pong-config-row">
                        <label>Their paddle</label>
                        <div class="pong-color-row">
                            <button
                                v-for="c in COLORS"
                                :key="c.value"
                                class="pong-color-swatch"
                                :style="{ background: c.value, outline: config.p2Color === c.value ? '2px solid #fff' : 'none' }"
                                :title="c.label"
                                @click="config.p2Color = c.value"
                            />
                        </div>
                    </div>

                    <button class="pong-config-btn" :disabled="creating" @click="createGame">
                        {{ creating ? 'Starting…' : 'Post Pong to Chat' }}
                    </button>
                </template>
            </div>
        </Teleport>

        <!-- Game panel (pinned above input bar) -->
        <Teleport to="body">
            <div v-if="gameOpen && currentRoom" class="pong-panel" :style="panelStyle">
                <div class="pong-panel-header">
                    <span class="pong-panel-title">
                        🏓
                        <span :style="{ color: currentRoom.data?.p1_color || '#fff' }">
                            {{ playerName(0) }}
                        </span>
                        <span class="pong-panel-score">{{ score1 }} — {{ score2 }}</span>
                        <span :style="{ color: currentRoom.data?.p2_color || '#ff4444' }">
                            {{ playerName(1) }}
                        </span>
                    </span>
                    <button class="pong-panel-close" @click="gameOpen = false">✕</button>
                </div>

                <div class="pong-canvas-wrap" @click="ensureFocus">
                    <canvas ref="canvasRef" :width="CW" :height="CH" class="pong-canvas" tabindex="0" />

                    <!-- Overlay states -->
                    <div v-if="currentRoom.status === 'waiting' && !mySeat" class="pong-overlay">
                        <p class="pong-overlay-text">{{ waitingText }}</p>
                        <button class="pong-overlay-btn" @click="joinGame">
                            {{ currentRoom.player_ids?.[0] == null ? 'Join as Player 1 (Left)' : 'Join as Player 2 (Right)' }}
                        </button>
                        <p class="pong-overlay-hint">Use ↑↓ arrow keys</p>
                    </div>

                    <div v-else-if="currentRoom.status === 'waiting' && mySeat" class="pong-overlay">
                        <p class="pong-overlay-text">Waiting for opponent…</p>
                    </div>

                    <div v-else-if="currentRoom.status === 'finished'" class="pong-overlay pong-overlay--winner">
                        <p class="pong-overlay-winner">{{ winnerText }}</p>
                        <button class="pong-overlay-btn" @click="gameOpen = false">Close</button>
                    </div>
                </div>

                <div class="pong-panel-footer">
                    <span v-if="mySeat" class="pong-panel-role">
                        You are <strong>{{ mySeat === 1 ? 'Player 1 (Left)' : 'Player 2 (Right)' }}</strong> — ↑↓ arrows
                    </span>
                    <span v-else class="pong-panel-role">Spectating</span>

                    <button
                        v-if="isRoomCreator && currentRoom.status !== 'finished'"
                        class="pong-panel-abandon"
                        @click="abandonGame"
                    >Abandon</button>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'

const props = defineProps({
    settings:      { type: Object, default: () => ({}) },
    apiBase:       { type: String, default: '' },
    authToken:     { type: String, default: '' },
    channelId:     { type: String, default: '' },
    currentMember: { type: Object, default: null },
})
const emit = defineEmits(['insert'])

// ── Constants ──────────────────────────────────────────────────────────────
const CW = 480
const CH = 290
const PADDLE_W = 10
const PADDLE_H = 64
const BALL_SZ  = 9
const PADDLE_SPEED = 0.016       // fraction of canvas height per frame
const BALL_SPEED_INIT  = 0.0045  // fraction of CW per frame at 60fps
const BALL_SPEED_MAX   = 0.012
const BALL_SPEED_ACCEL = 1.03    // speed multiplier per paddle hit
const SYNC_INTERVAL    = 100     // ms between state pushes
const POLL_INTERVAL    = 100     // ms between state polls (P2/spectator)
const CHECK_INTERVAL   = 4000    // ms between active-game checks

const COLORS = [
    { label: 'White',   value: '#ffffff' },
    { label: 'Red',     value: '#ff4444' },
    { label: 'Blue',    value: '#4488ff' },
    { label: 'Green',   value: '#44ee88' },
    { label: 'Yellow',  value: '#ffdd22' },
    { label: 'Cyan',    value: '#22ddff' },
    { label: 'Purple',  value: '#cc66ff' },
    { label: 'Orange',  value: '#ff8833' },
]

// ── Refs ───────────────────────────────────────────────────────────────────
const wrapRef   = ref(null)
const canvasRef = ref(null)
const open      = ref(false)
const gameOpen  = ref(false)
const creating  = ref(false)

// Network state
const activeRoom  = ref(null)   // active game in channel (from periodic check)
const currentRoom = ref(null)   // the room we're playing/watching
const mySeat      = ref(null)   // 1 or 2 (or null = spectator)
const myUserId    = computed(() => props.currentMember?.id ?? null)
const isRoomCreator = ref(false)

// Game state (normalised 0–1)
const p1y   = ref(0.5)
const p2y   = ref(0.5)
const score1 = ref(0)
const score2 = ref(0)
const ball  = ref({ x: 0.5, y: 0.5, vx: BALL_SPEED_INIT, vy: BALL_SPEED_INIT * 0.7 })

// Config for new game
const config = ref({ scoreLimit: 5, p1Color: '#ffffff', p2Color: '#ff4444' })

// Panel positioning
const configStyle = ref({})
const panelStyle  = ref({})

// Timing & loops
let rafId = null
let syncTimer = null
let pollTimer = null
let checkTimer = null
const keys = {}

// Invited user (from context menu)
const invitedUsername = ref(null)

// ── Computed ───────────────────────────────────────────────────────────────
const waitingText = computed(() => {
    const r = currentRoom.value
    if (!r) return ''
    const hasP1 = r.player_ids?.[0] != null
    const hasP2 = r.player_ids?.[1] != null
    if (!hasP1 && !hasP2) return 'First to grab gets the left paddle!'
    if (hasP1 && !hasP2)  return 'One player waiting — grab the right paddle!'
    return 'Starting…'
})

const winnerText = computed(() => {
    const r = currentRoom.value
    if (!r) return ''
    const winnerIdx = (r.data?.winner === 'p1') ? 0 : 1
    const name = r.player_names?.[winnerIdx] ?? `Player ${winnerIdx + 1}`
    return `🏆 ${name} wins!`
})

function playerName(idx) {
    return currentRoom.value?.player_names?.[idx] ?? `P${idx + 1}`
}

// ── Positioning ────────────────────────────────────────────────────────────
function computeStyles() {
    const rect = wrapRef.value?.getBoundingClientRect()
    if (!rect) return

    // Config panel: above the button
    configStyle.value = {
        left:   Math.max(8, Math.min(rect.left, window.innerWidth - 280)) + 'px',
        bottom: (window.innerHeight - rect.top + 8) + 'px',
    }

    // Game panel: full-width above input bar, pinned to bottom-left of channel area
    panelStyle.value = {
        left:   Math.max(8, rect.left - 120) + 'px',
        bottom: (window.innerHeight - rect.top + 8) + 'px',
        width:  (CW + 2) + 'px',
    }
}

// ── Toggle ─────────────────────────────────────────────────────────────────
function toggle() {
    if (!open.value) {
        computeStyles()
        open.value = true
    } else {
        open.value = false
    }
}

function openGame() {
    if (activeRoom.value) {
        currentRoom.value = activeRoom.value
        syncSeatFromRoom()
    }
    computeStyles()
    gameOpen.value = true
    open.value = false
    nextTick(startGameLoop)
}

// ── Auth helper ────────────────────────────────────────────────────────────
function headers() {
    const token = props.authToken || localStorage.getItem('eluth_token') || ''
    return {
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
    }
}

async function api(method, path, body) {
    const res = await fetch(props.apiBase + path, {
        method,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 204) return null
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`)
    return data
}

// ── Room management ────────────────────────────────────────────────────────
async function checkActiveRoom() {
    if (!props.channelId) return
    try {
        const data = await api('GET', `/plugin-rooms/pong/channels/${props.channelId}`)
        activeRoom.value = data?.room ?? null
        // If we have a current game that just finished, sync it
        if (currentRoom.value && data?.room?.id === currentRoom.value.id) {
            currentRoom.value = data.room
            applyRoomState(data.room)
        }
    } catch {}
}

async function createGame() {
    if (creating.value || !props.channelId) return
    creating.value = true
    try {
        const data = await api('POST', '/plugin-rooms/pong', {
            channel_id:  props.channelId,
            max_players: 2,
            data: {
                score_limit: config.value.scoreLimit,
                p1_color:    config.value.p1Color,
                p2_color:    config.value.p2Color,
                score1: 0, score2: 0,
                p1_y: 0.5, p2_y: 0.5,
                ball_x: 0.5, ball_y: 0.5,
                ball_vx: BALL_SPEED_INIT, ball_vy: BALL_SPEED_INIT * 0.7,
                winner: null,
                invited: invitedUsername.value ?? null,
            },
        })
        const room = data.room
        activeRoom.value = room
        currentRoom.value = room
        isRoomCreator.value = true
        open.value = false

        // Post the game link to chat
        const gameUrl = window.location.origin + '/pong-game/' + room.id
        const mention = invitedUsername.value ? `@${invitedUsername.value} ` : ''
        emit('insert', mention + gameUrl)
        invitedUsername.value = null

        // Auto-join as player 1
        await joinGame()
    } catch (e) {
        console.warn('[pong] create failed', e)
        // If already active game, open it
        await checkActiveRoom()
        if (activeRoom.value) openGame()
    } finally {
        creating.value = false
    }
}

async function joinGame() {
    if (!currentRoom.value) return
    try {
        const data = await api('POST', `/plugin-rooms/pong/${currentRoom.value.id}/seat`)
        mySeat.value    = data.seat
        currentRoom.value = data.room
        computeStyles()
        gameOpen.value = true
        startGameLoop()
    } catch (e) {
        // Seat taken — open as spectator
        mySeat.value = null
        computeStyles()
        gameOpen.value = true
        startGameLoop()
    }
}

async function abandonGame() {
    if (!currentRoom.value) return
    try {
        await api('POST', `/plugin-rooms/pong/${currentRoom.value.id}/close`)
        stopGameLoop()
        gameOpen.value  = false
        currentRoom.value = null
        activeRoom.value  = null
    } catch {}
}

function syncSeatFromRoom() {
    if (!currentRoom.value || !myUserId.value) return
    const ids = currentRoom.value.player_ids ?? []
    const idx = ids.indexOf(myUserId.value)
    mySeat.value = idx >= 0 ? idx + 1 : null
}

// ── Game loop ──────────────────────────────────────────────────────────────
function startGameLoop() {
    stopGameLoop()

    if (mySeat.value === 1) {
        // Player 1: run physics, push state
        rafId = requestAnimationFrame(gameLoop)
        syncTimer = setInterval(pushState, SYNC_INTERVAL)
    } else if (mySeat.value === 2) {
        // Player 2: run local movement, push own paddle, poll ball from P1
        rafId = requestAnimationFrame(gameLoop)
        syncTimer = setInterval(pushState, SYNC_INTERVAL)
        pollTimer = setInterval(pullState, POLL_INTERVAL)
    } else {
        // Spectator
        rafId = requestAnimationFrame(gameLoop)
        pollTimer = setInterval(pullState, POLL_INTERVAL * 3)
    }

    nextTick(() => canvasRef.value?.focus())
}

function stopGameLoop() {
    if (rafId)      { cancelAnimationFrame(rafId); rafId = null }
    if (syncTimer)  { clearInterval(syncTimer);    syncTimer = null }
    if (pollTimer)  { clearInterval(pollTimer);    pollTimer = null }
}

function gameLoop() {
    if (!gameOpen.value) return
    update()
    draw()
    rafId = requestAnimationFrame(gameLoop)
}

// ── Physics ────────────────────────────────────────────────────────────────
function update() {
    const room = currentRoom.value
    if (!room || room.status !== 'active') return

    const speed = PADDLE_SPEED
    if (mySeat.value === 1) {
        if (keys['ArrowUp'])   p1y.value = Math.max(PADDLE_H / 2 / CH, p1y.value - speed)
        if (keys['ArrowDown']) p1y.value = Math.min(1 - PADDLE_H / 2 / CH, p1y.value + speed)

        // Ball physics (P1 is authoritative)
        const b = ball.value
        b.x += b.vx
        b.y += b.vy

        // Wall bounce (top/bottom)
        const ballRY = BALL_SZ / 2 / CH
        if (b.y - ballRY <= 0)  { b.y = ballRY;      b.vy = Math.abs(b.vy) }
        if (b.y + ballRY >= 1)  { b.y = 1 - ballRY;  b.vy = -Math.abs(b.vy) }

        // Left paddle collision
        const p1Rect = { x: 12 / CW, y: p1y.value, h: PADDLE_H / CH }
        if (b.vx < 0 && b.x - BALL_SZ/2/CW <= p1Rect.x + PADDLE_W/CW &&
            Math.abs(b.y - p1Rect.y) < p1Rect.h / 2 + BALL_SZ/2/CH) {
            b.vx  = Math.min(BALL_SPEED_MAX, Math.abs(b.vx) * BALL_SPEED_ACCEL)
            b.vy += (b.y - p1Rect.y) * 0.04
            b.x   = (12 + PADDLE_W + BALL_SZ / 2) / CW
        }

        // Right paddle collision
        const p2Rect = { x: (CW - 12 - PADDLE_W) / CW, y: p2y.value, h: PADDLE_H / CH }
        if (b.vx > 0 && b.x + BALL_SZ/2/CW >= p2Rect.x &&
            Math.abs(b.y - p2Rect.y) < p2Rect.h / 2 + BALL_SZ/2/CH) {
            b.vx  = -Math.min(BALL_SPEED_MAX, Math.abs(b.vx) * BALL_SPEED_ACCEL)
            b.vy += (b.y - p2Rect.y) * 0.04
            b.x   = p2Rect.x - BALL_SZ/2/CW
        }

        // Clamp vy
        const maxVy = Math.abs(b.vx) * 1.2
        b.vy = Math.max(-maxVy, Math.min(maxVy, b.vy))

        // Scoring
        if (b.x < 0) { score2.value++; checkWin(); resetBall(-1) }
        if (b.x > 1) { score1.value++; checkWin(); resetBall(1) }

    } else if (mySeat.value === 2) {
        if (keys['ArrowUp'])   p2y.value = Math.max(PADDLE_H / 2 / CH, p2y.value - speed)
        if (keys['ArrowDown']) p2y.value = Math.min(1 - PADDLE_H / 2 / CH, p2y.value + speed)
        // Ball and P1 paddle come from server (applied via applyRoomState)
    }
}

function resetBall(dir) {
    ball.value = {
        x:  0.5,
        y:  0.4 + Math.random() * 0.2,
        vx: BALL_SPEED_INIT * dir,
        vy: (Math.random() - 0.5) * BALL_SPEED_INIT,
    }
}

async function checkWin() {
    const limit = currentRoom.value?.data?.score_limit ?? 5
    if (score1.value >= limit || score2.value >= limit) {
        const winner = score1.value >= limit ? 'p1' : 'p2'
        try {
            await api('PUT', `/plugin-rooms/pong/${currentRoom.value.id}/data`, {
                data: { winner, score1: score1.value, score2: score2.value }
            })
            await api('POST', `/plugin-rooms/pong/${currentRoom.value.id}/close`)
            currentRoom.value = { ...currentRoom.value, status: 'finished', data: { ...currentRoom.value.data, winner } }
            activeRoom.value = null
            stopGameLoop()
        } catch {}
    }
}

// ── Server sync ────────────────────────────────────────────────────────────
async function pushState() {
    if (!currentRoom.value || currentRoom.value.status !== 'active') return
    try {
        const b = ball.value
        const patch = { p2_y: p2y.value }
        if (mySeat.value === 1) {
            Object.assign(patch, {
                p1_y: p1y.value,
                ball_x: b.x, ball_y: b.y,
                ball_vx: b.vx, ball_vy: b.vy,
                score1: score1.value, score2: score2.value,
            })
        }
        const data = await api('PUT', `/plugin-rooms/pong/${currentRoom.value.id}/data`, { data: patch })
        if (data?.room) applyRoomState(data.room)
    } catch {}
}

async function pullState() {
    if (!currentRoom.value) return
    try {
        const data = await api('GET', `/plugin-rooms/pong/${currentRoom.value.id}`)
        if (data?.room) applyRoomState(data.room)
    } catch {}
}

function applyRoomState(room) {
    if (!room) return
    currentRoom.value = room
    const d = room.data ?? {}

    if (mySeat.value !== 1) {
        // P2 and spectators get P1's ball and P1's paddle from server
        if (d.ball_x  != null) ball.value.x  = d.ball_x
        if (d.ball_y  != null) ball.value.y  = d.ball_y
        if (d.ball_vx != null) ball.value.vx = d.ball_vx
        if (d.ball_vy != null) ball.value.vy = d.ball_vy
        if (d.p1_y    != null) p1y.value     = d.p1_y
        if (d.score1  != null) score1.value  = d.score1
        if (d.score2  != null) score2.value  = d.score2
    }
    if (mySeat.value !== 2) {
        if (d.p2_y != null) p2y.value = d.p2_y
    }

    if (room.status === 'active' && mySeat.value == null) {
        syncSeatFromRoom()
    }
    if (room.status === 'finished') {
        stopGameLoop()
    }
}

function ensureFocus() {
    canvasRef.value?.focus()
}

// ── Drawing ────────────────────────────────────────────────────────────────
function draw() {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const room = currentRoom.value
    const d    = room?.data ?? {}

    ctx.clearRect(0, 0, CW, CH)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, CW, CH)

    // Dotted center line
    ctx.save()
    ctx.setLineDash([8, 8])
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.moveTo(CW / 2, 0)
    ctx.lineTo(CW / 2, CH)
    ctx.stroke()
    ctx.restore()

    // Left paddle
    const p1Color = d.p1_color || '#ffffff'
    ctx.fillStyle = p1Color
    const p1px = 12
    const p1py = p1y.value * CH - PADDLE_H / 2
    ctx.fillRect(p1px, p1py, PADDLE_W, PADDLE_H)

    // Right paddle
    const p2Color = d.p2_color || '#ff4444'
    ctx.fillStyle = p2Color
    const p2px = CW - 12 - PADDLE_W
    const p2py = p2y.value * CH - PADDLE_H / 2
    ctx.fillRect(p2px, p2py, PADDLE_W, PADDLE_H)

    // Ball (skip if game not started/finished)
    if (room?.status === 'active') {
        ctx.fillStyle = '#fff'
        const bx = ball.value.x * CW - BALL_SZ / 2
        const by = ball.value.y * CH - BALL_SZ / 2
        ctx.fillRect(bx, by, BALL_SZ, BALL_SZ)
    }

    // Scores
    ctx.font = 'bold 36px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillText(score1.value, CW / 4, 52)
    ctx.fillText(score2.value, (3 * CW) / 4, 52)
}

// ── Keyboard ───────────────────────────────────────────────────────────────
function onKeyDown(e) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        keys[e.key] = true
    }
}
function onKeyUp(e) { keys[e.key] = false }

// ── Close on outside click ─────────────────────────────────────────────────
function onClickOutside(e) {
    if (open.value && wrapRef.value && !wrapRef.value.contains(e.target)) {
        open.value = false
    }
}

// ── Invite / open events ───────────────────────────────────────────────────
function onInvite(e) {
    const { author, channelId } = e.detail
    if (channelId !== props.channelId) return
    invitedUsername.value = author
    config.value.p1Color = '#4488ff'
    config.value.p2Color = '#ff4444'
    computeStyles()
    open.value = true
}

function onOpen(e) {
    const { id } = e.detail
    if (currentRoom.value?.id === id || activeRoom.value?.id === id) {
        openGame()
    }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(() => {
    document.addEventListener('click',       onClickOutside)
    document.addEventListener('keydown',     onKeyDown)
    document.addEventListener('keyup',       onKeyUp)
    document.addEventListener('pong:invite', onInvite)
    document.addEventListener('pong:open',   onOpen)
    checkActiveRoom()
    checkTimer = setInterval(checkActiveRoom, CHECK_INTERVAL)
})

onUnmounted(() => {
    document.removeEventListener('click',       onClickOutside)
    document.removeEventListener('keydown',     onKeyDown)
    document.removeEventListener('keyup',       onKeyUp)
    document.removeEventListener('pong:invite', onInvite)
    document.removeEventListener('pong:open',   onOpen)
    stopGameLoop()
    clearInterval(checkTimer)
})

watch(gameOpen, (v) => {
    if (!v) stopGameLoop()
})
</script>

<style scoped>
.pong-wrap { position: relative; display: inline-flex; align-items: center; }

.pong-btn {
    background: none; border: none; cursor: pointer;
    font-size: 19px; line-height: 1; padding: 5px 6px; border-radius: 6px;
    transition: background 0.15s;
}
.pong-btn:hover, .pong-btn.active { background: rgba(255,255,255,0.1); }

.pong-badge {
    position: absolute; top: 0; right: -2px;
    background: #ef4444; color: #fff; font-size: 8px; font-weight: 800;
    border-radius: 6px; padding: 1px 4px; line-height: 1.4;
}

/* Config panel */
.pong-config {
    position: fixed; z-index: 9999;
    width: 264px;
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    display: flex; flex-direction: column; gap: 10px;
}
.pong-config-header {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.9);
}
.pong-config-close {
    background: none; border: none; color: rgba(255,255,255,0.4);
    cursor: pointer; font-size: 14px; padding: 0 2px;
}
.pong-config-close:hover { color: rgba(255,255,255,0.8); }

.pong-config-row {
    display: flex; flex-direction: column; gap: 5px;
}
.pong-config-row label { font-size: 11px; color: rgba(255,255,255,0.45); }

.pong-score-picker { display: flex; gap: 6px; }
.pong-score-opt {
    flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.7); border-radius: 5px; padding: 5px 0;
    font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.1s;
}
.pong-score-opt:hover { background: rgba(255,255,255,0.12); }
.pong-score-opt.active { background: var(--accent, #a78bfa); border-color: transparent; color: #fff; }

.pong-color-row { display: flex; gap: 6px; flex-wrap: wrap; }
.pong-color-swatch {
    width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
    border: none; outline-offset: 2px;
    transition: transform 0.1s;
}
.pong-color-swatch:hover { transform: scale(1.15); }

.pong-config-btn {
    background: var(--accent, #a78bfa); color: #fff; border: none;
    border-radius: 6px; padding: 8px; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: opacity 0.15s;
}
.pong-config-btn:hover:not(:disabled) { opacity: 0.88; }
.pong-config-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.pong-config-active { text-align: center; }
.pong-config-active p { font-size: 12px; color: rgba(255,255,255,0.5); margin: 0 0 8px; }

/* Game panel */
.pong-panel {
    position: fixed; z-index: 9998;
    background: #111;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,0.7);
    display: flex; flex-direction: column;
}
.pong-panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px;
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.07);
    font-size: 13px;
}
.pong-panel-title { display: flex; align-items: center; gap: 6px; }
.pong-panel-score { font-weight: 700; font-size: 15px; color: #fff; }
.pong-panel-close {
    background: none; border: none; color: rgba(255,255,255,0.4);
    cursor: pointer; font-size: 16px; line-height: 1;
}
.pong-panel-close:hover { color: rgba(255,255,255,0.8); }

.pong-canvas-wrap { position: relative; }
.pong-canvas { display: block; background: #000; outline: none; cursor: default; }

.pong-overlay {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px;
    background: rgba(0,0,0,0.65);
}
.pong-overlay-text { font-size: 14px; color: rgba(255,255,255,0.7); text-align: center; margin: 0; }
.pong-overlay-hint { font-size: 11px; color: rgba(255,255,255,0.35); margin: 0; }
.pong-overlay-btn {
    background: var(--accent, #a78bfa); color: #fff; border: none;
    border-radius: 6px; padding: 8px 22px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.pong-overlay-btn:hover { opacity: 0.88; }
.pong-overlay--winner .pong-overlay-winner {
    font-size: 22px; font-weight: 800; color: #ffd700;
    text-shadow: 0 0 20px rgba(255,215,0,0.4);
    margin: 0;
}

.pong-panel-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 12px;
    font-size: 11px; color: rgba(255,255,255,0.4);
    border-top: 1px solid rgba(255,255,255,0.06);
    background: rgba(0,0,0,0.3);
}
.pong-panel-abandon {
    background: none; border: 1px solid rgba(255,60,60,0.3);
    color: rgba(255,80,80,0.7); border-radius: 4px; padding: 2px 8px;
    font-size: 11px; cursor: pointer;
}
.pong-panel-abandon:hover { background: rgba(255,60,60,0.1); }
</style>
