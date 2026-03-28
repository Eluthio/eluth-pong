import PongLauncher from './PongLauncher.vue'

window.__EluthPlugins = window.__EluthPlugins || {}
window.__EluthPlugins['pong'] = {
    component: PongLauncher,
    zones:     ['input'],

    // Right-click context menu item — shown on other users (not self)
    contextMenuItems: [
        {
            label: '🏓 Invite to Pong',
            when:  ({ isSelf }) => !isSelf,
            action({ author, memberId, channelId }) {
                document.dispatchEvent(new CustomEvent('pong:invite', {
                    detail: { author, memberId, channelId }
                }))
            },
        },
    ],

    // Detect pong game URLs in chat messages and render a game card
    messageRenderer: {
        pattern: /\/pong-game\/[0-9a-f-]{36}/,
        render(url) {
            const id = url.match(/\/pong-game\/([0-9a-f-]{36})/)?.[1]
            if (!id) return null
            return `<span class="pong-msg-card" data-pong-id="${id}">
                <span class="pong-card-icon">🏓</span>
                <span class="pong-card-text">Pong game</span>
                <button class="pong-card-btn" onclick="document.dispatchEvent(new CustomEvent('pong:open',{detail:{id:'${id}'}}))">Join / Watch</button>
            </span>`
        },
    },
}

// Inject global styles for message card
const style = document.createElement('style')
style.textContent = `
.pong-msg-card {
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px; padding: 8px 14px; margin: 4px 0;
    font-size: 13px; color: rgba(255,255,255,0.8);
}
.pong-card-icon { font-size: 20px; }
.pong-card-btn {
    background: var(--accent, #a78bfa); color: #fff; border: none;
    border-radius: 5px; padding: 4px 12px; font-size: 12px; font-weight: 600;
    cursor: pointer; margin-left: 4px;
}
.pong-card-btn:hover { opacity: 0.85; }
`
document.head.appendChild(style)
