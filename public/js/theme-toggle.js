/**
 * THEME TOGGLE MODULE
 * Standardized Dark Mode logic for demCalendar
 * Behavior: Dark Mode by DEFAULT.
 */

// 1. Normalize stored theme values and apply immediately to prevent flash.
function normalizeStoredTheme() {
    const stored = localStorage.getItem('darkMode');
    if (stored === 'enabled') {
        localStorage.setItem('darkMode', 'true');
        return 'true';
    }
    if (stored === 'disabled') {
        localStorage.setItem('darkMode', 'false');
        return 'false';
    }
    return stored;
}

// Logic: If 'light' is explicitly stored, use light. Otherwise (null or 'dark'), force DARK.
function initTheme() {
    const stored = normalizeStoredTheme();
    if (stored === 'false') {
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
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
        } else {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
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
