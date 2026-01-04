/**
 * THEME TOGGLE MODULE
 * Standardized Dark Mode logic for Sherpas Calendar App
 * Behavior: Dark Mode by DEFAULT.
 */

// 1. Apply theme immediately on load to prevent flash
// Logic: If 'light' is explicitly stored, use light. Otherwise (null or 'dark'), force DARK.
function initTheme() {
    if (localStorage.getItem('darkMode') === 'false') {
        document.documentElement.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
    }
    updateIcons();
}

// 2. Update Icons (Sun/Moon)
function updateIcons() {
    const isDark = document.documentElement.classList.contains('dark');
    const moonIcon = document.getElementById('theme-icon-moon');
    const sunIcon = document.getElementById('theme-icon-sun');

    if (moonIcon && sunIcon) {
        if (isDark) {
            moonIcon.classList.add('hidden'); // In dark mode, we show SUN (to switch to light) or MOON?
            // Usually: Dark Mode Active -> Show SUN icon (to switch to light)
            // But manager.html had: 
            // - moon hidden in light mode (shows moon to go dark)
            // - sun hidden in dark mode (shows sun to go light)

            // Let's stick to standard practice:
            // If Dark -> Show Sun (to toggle light)
            // If Light -> Show Moon (to toggle dark)

            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
        } else {
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
        }
    }
}

// 3. Toggle Function
function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');

    if (isDark) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('darkMode', 'false');
    } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('darkMode', 'true');
    }

    updateIcons();
}

// 4. Initialize
initTheme();

// 5. Attach Event Listener when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleTheme);
    }
    // Re-run updateIcons to ensure UI matches state
    updateIcons();
});

// Export for module usage if needed, though side-effects run automatically
export { toggleTheme };
