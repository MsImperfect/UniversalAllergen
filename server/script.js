const foodDatabase = {
    "peanut butter": { category: "peanuts" },
    "cow milk": { category: "dairy" },
    "wheat bread": { category: "wheat" },
    "chocolate": { category: "dairy" }
};


function performScan() {
    const input = document.getElementById('productInput').value.trim().toLowerCase();
    const blacklist = JSON.parse(localStorage.getItem('userBlacklist')) || [];
    const product = foodDatabase[input];
    const resultArea = document.getElementById('result-display');

    if (!product) {
        alert("Product not found. Try: 'cow milk' or 'peanut butter'.");
        return;
    }

    // history tracking
    let scanHistory = JSON.parse(localStorage.getItem('scanHistory')) || [];
    
    const scanEntry = {
        name: input.toUpperCase(),
        status: "", 
        time: new Date().toLocaleTimeString(),
        category: product.category.toUpperCase()
    };

    // Determine safety for the entry
    let isUnsafe = false;
    blacklist.forEach(allergen => {
        if (product.category.includes(allergen) || (allergen === "milk" && product.category === "dairy")) {
            isUnsafe = true;
        }
    });

    scanEntry.status = isUnsafe ? "⚠️ RESTRICTED" : "✅ SAFE";
    scanHistory.unshift(scanEntry);
    if(scanHistory.length > 10) scanHistory.pop();

    localStorage.setItem('scanHistory', JSON.stringify(scanHistory));

    // Update UI Result
    const color = isUnsafe ? "#ef4444" : "#10b981";
    resultArea.innerHTML = `
        <div style="background: ${color}; color: white; padding: 25px; border-radius: 20px; margin-top: 30px; text-align: center; box-shadow: 0 10px 20px rgba(0,0,0,0.3);">
            <h2 style="margin: 0;">${scanEntry.status}</h2>
            <p>ID: ${product.category.toUpperCase()}</p>
        </div>
    `;
}
//Sidebar Persistence
function toggleSidebar() {
    const sidebar = document.getElementById('mySidebar');
    const isCollapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarState', isCollapsed ? 'collapsed' : 'expanded');
}

window.onload = function() {
    const sidebar = document.getElementById('mySidebar');
    const toggleBtn = document.getElementById('toggle-btn');

    //Restore Sidebar State
    if (localStorage.getItem('sidebarState') === 'collapsed') {
        sidebar.classList.add('collapsed');
    }

    // Sidebar Toggle Listener
    if (toggleBtn) {
        toggleBtn.onclick = function() {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarState', isCollapsed ? 'collapsed' : 'expanded');
        };
    }

    //Highlight Active Page Link
    const path = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll('nav a').forEach(link => {
        if (link.getAttribute('href') === path) {
            link.classList.add('active');
        }
    });

    //Attach Feature Listeners
    const scanBtn = document.getElementById('scanBtn');
    if (scanBtn) scanBtn.onclick = performScan;

    const reportBtn = document.getElementById('newReportBtn');
    if (reportBtn) reportBtn.onclick = handleCommunityReport;
};

// FEATURE: Live Community Feed Update
function handleCommunityReport() {
    const reportText = prompt("Enter your safety alert:");
    if (reportText && reportText.trim() !== "") {
        const feed = document.getElementById('feedContainer');
        const newPost = document.createElement('article');
        newPost.style.cssText = "border-bottom: 1px solid #eee; padding: 20px 0; background: rgba(59, 130, 246, 0.1); border-radius: 15px; margin-bottom: 10px;";
        newPost.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 15px;">
                <span class="badge" style="background: #3b82f6; color:white;">USER ALERT</span>
                <small>Just now</small>
            </div>
            <p style="margin: 10px 15px;"><strong>@User:</strong> ${reportText}</p>
        `;
        // Inject into feed container
        if(feed) feed.insertBefore(newPost, feed.children[3]); 
    }
}