export function initMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    const closeMenu = document.getElementById('close-menu');
    const mobileMenu = document.getElementById('mobile-menu');

    if (menuToggle && mobileMenu) {
        menuToggle.addEventListener('click', () => {
            mobileMenu.classList.remove('hidden');
        });
    }

    if (closeMenu && mobileMenu) {
        closeMenu.addEventListener('click', () => {
            mobileMenu.classList.add('hidden');
        });
    }

    if (mobileMenu) {
        mobileMenu.addEventListener('click', (e) => {
            if (e.target.id === 'mobile-menu') {
                mobileMenu.classList.add('hidden');
            }
        });
    }

    // Handle Mobile Logout by triggering the main logout button
    // This avoids re-implementing auth logic here or adding more dependencies
    const logoutBtnMobile = document.getElementById('logout-btn-mobile');
    if (logoutBtnMobile) {
        logoutBtnMobile.addEventListener('click', (e) => {
            e.preventDefault();
            const mainLogout = document.getElementById('logout-btn');
            if (mainLogout) {
                mainLogout.click();
            } else {
                console.warn('Main logout button not found, mobile logout might fail if no fallback logic exists.');
                // Fallback or explicit handling if you want to be safe, 
                // but for now relying on the main button presence is consistent with the app structure.
            }
        });
    }
}
