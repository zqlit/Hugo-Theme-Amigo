let artalkInstances = [];

document.addEventListener("DOMContentLoaded", function() {
    initMoments();
    initArtalk();
});

// Clean up Artalk instances before PJAX navigation
document.addEventListener("pjax:send", function() {
    artalkInstances.forEach(inst => {
        if (inst && typeof inst.destroy === 'function') {
            inst.destroy();
        }
    });
    artalkInstances = [];
});

// Re-init on PJAX complete if used
document.addEventListener("pjax:complete", function() {
    initMoments();
    initArtalk();
});

function initArtalk() {
    const containers = document.querySelectorAll('.moment-comments-area');
    if (!containers.length || !window.amigoConfig) return;

    containers.forEach(el => {
        // Prevent double init
        if (el.dataset.artalkInit) return;
        
        const pageKey = el.dataset.pageKey;
        if (!pageKey) return;

        // Determine if it's Feed (Read-Only) or Single (Interactive)
        const isFeed = el.classList.contains('feed-comments');

        try {
            let ArtalkConstructor = window.Artalk;
            if (typeof ArtalkConstructor !== 'function' && ArtalkConstructor.default) {
                ArtalkConstructor = ArtalkConstructor.default;
            }

            const config = {
                el: el,
                pageKey: pageKey,
                pageTitle: document.title,
                server: window.amigoConfig.artalkServer,
                site: window.amigoConfig.artalkSite,
                darkMode: document.body.classList.contains('dark-mode'), // Auto detect if theme has dark mode class
                useBackendConf: true,
                flatMode: true, // Always flat for Moments style
                nestMax: 1,
                gravatar: {
                   mirror: 'https://cravatar.cn/avatar/'
                }
            };

            // Feed specific overrides
            if (isFeed) {
                // Read-only-ish: hide editor via CSS (already done)
            } else {
                // Single page specific
            }

            const artalk = new ArtalkConstructor(config);

            // Hook into list loaded to format replies and process likes
            artalk.on('list-loaded', (comments) => {
                if (isFeed) {
                    // For feed, we use Custom Renderer (Data Driven)
                    // The 'comments' param usually contains the list of data
                    // If not, we might need artalk.getCommentList() (depending on version)
                    // But list-loaded(data) is standard.
                    
                    // We need to check if comments is array or object with data
                    let dataList = [];
                    if (Array.isArray(comments)) {
                        dataList = comments;
                    } else if (comments && Array.isArray(comments.data)) {
                        dataList = comments.data;
                    }
                    
                    renderWeChatFeed(artalk, el, dataList);
                } else {
                    // For single page, we use DOM processing if needed (or keep standard)
                    processWeChatStyle(el, false);
                }
            });

            artalkInstances.push(artalk);
            el.dataset.artalkInit = "true";
            
            // Attach Like Button Event (Feed Only)
            if (isFeed) {
                const card = el.closest('.moment-card');
                if (card) {
                    const likeBtn = card.querySelector('.btn-like');
                    if (likeBtn) {
                         // Ensure we don't attach multiple listeners if re-init happens weirdly
                         // (though el.dataset.artalkInit guard prevents this function from running twice on same el)
                         likeBtn.addEventListener('click', (e) => {
                             e.stopPropagation();
                             e.preventDefault();
                             
                             // Close popover
                             const popover = likeBtn.closest('.action-popover');
                             if (popover) popover.classList.remove('is-visible');

                             handleLikeAction(artalk);
                         });
                    }
                }
            }

        } catch (e) {
            console.error('Artalk init failed:', e);
        }
    });
}

/**
 * Handle Like Action
 * Sends a comment "[LIKE]" via Artalk
 */
function handleLikeAction(artalkInstance) {
    // Check if user has data (Artalk 2.x stores in artalk.user.data)
    let user = artalkInstance.ctx.get('user').getData();
    let currentNick = user.nick;
    let currentEmail = user.email;

    // Auto-generate "Visitor + Number" if no nick
    if (!currentNick) {
        const randomNum = Math.floor(Math.random() * 10000) + 1;
        currentNick = `访客${randomNum}`;
        currentEmail = `visitor${randomNum}@example.com`; // Fake email
        
        // Update Artalk User Data (Best effort)
        try {
            artalkInstance.ctx.get('user').update({
                nick: currentNick,
                email: currentEmail
            });
        } catch (e) { console.warn('Failed to update user data', e); }
    }

    // Submit "[LIKE]" comment
    // We use the editor instance to submit.
    // Artalk 2.8+ API check: artalkInstance.getEditor() or artalkInstance.editor?
    // In Artalk 2.x, editor might be in ctx.get('editor')
    
    // Attempt 1: Standard public API
    let editor = artalkInstance.editor;
    
    // Attempt 2: Getter method
    if (!editor && typeof artalkInstance.getEditor === 'function') {
        editor = artalkInstance.getEditor();
    }
    
    // Attempt 3: Internal Context (Most reliable for Artalk 2.8.x)
    // Artalk 2.8.7: artalkInstance.ctx.get('editor')
    if (!editor && artalkInstance.ctx && typeof artalkInstance.ctx.get === 'function') {
        try {
            editor = artalkInstance.ctx.get('editor');
        } catch (e) {
            console.warn('Failed to get editor from ctx', e);
        }
    }

    // Validate editor instance (Must have getContent and setContent)
    if (editor && (typeof editor.getContent !== 'function' || typeof editor.setContent !== 'function')) {
        console.warn('Editor instance found but missing required methods (getContent/setContent). Treating as missing.', editor);
        editor = null;
    }
    
    // Attempt 4: If still null, check if we are in "read-only" mode or if editor is not initialized?
    // In Artalk, editor component might not be loaded if configured off, but we need it.
    
    if (!editor) {
        // Fallback: Try to use HTTP API directly using artalkInstance.ctx.get('http')
        console.warn('Artalk Editor instance not found. Trying HTTP API fallback.');
        
        // Show loading
        if (typeof Qmsg !== 'undefined') Qmsg.loading('正在点赞...', { autoClose: true });

        // Random phrases for visitor likes
    const randomPhrases = [
        '很棒的文章！', 'Get！', '不错不错', '支持一下', '写得很好', 'Mark', '顶一下', 'Interesting', 'Cool', '👍'
    ];
    const randomPhrase = randomPhrases[Math.floor(Math.random() * randomPhrases.length)];
    const likeContent = `👍 已点赞 ${randomPhrase} <span style="display:none">[LIKE]</span>`;

    const payload = {
        nick: currentNick,
        name: currentNick, 
        email: currentEmail,
        link: user.link || '',
        content: likeContent,
        page_key: artalkInstance.conf.pageKey,
        page_title: artalkInstance.conf.pageTitle,
        site_name: artalkInstance.conf.site
    };

        const onSuccess = () => {
             if (typeof Qmsg !== 'undefined') Qmsg.success('点赞成功');
             // Reload list
             artalkInstance.reload();
             // Optimistic UI Update (optional, but good for feedback)
             // We can let reload handle it for now as it's cleaner
        };

        const onError = (err) => {
            console.error('Like failed:', err);
            if (typeof Qmsg !== 'undefined') {
                Qmsg.error('点赞失败: ' + (err.message || err));
            } else {
                alert('点赞失败: ' + (err.message || err));
            }
        };

        // Try Artalk Internal HTTP
        try {
            const http = artalkInstance.ctx.get('http');
            if (http && typeof http.post === 'function') {
                 http.post('/comments', payload)
                    .then(res => {
                        onSuccess();
                    })
                    .catch(err => {
                        // Try native fetch if internal http fails request
                        throw err; 
                    });
                 return;
            }
        } catch (e) {
             console.warn('Artalk internal HTTP API unavailable, proceeding to native fetch.', e);
        }

        // Native Fetch Fallback
        try {
            const serverUrl = artalkInstance.conf.server.replace(/\/$/, '');
            const apiUrl = `${serverUrl}/api/v2/comments`; 
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (user.token) {
                headers['Authorization'] = `Bearer ${user.token}`;
            }

            fetch(apiUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => { throw new Error(err.msg || 'Unknown error') });
                }
                return response.json();
            })
            .then(data => {
                onSuccess();
            })
            .catch(error => {
                onError(error);
            });
            return;
        } catch (e) {
             onError(e);
        }

        if (typeof Qmsg !== 'undefined') Qmsg.error('无法提交点赞：编辑器未找到且 API 失败');
        return;
    }

    // Backup current content (should be empty usually)
    const originalContent = editor.getContent();
    
    // Use the same random content logic for Editor submission fallback
    const randomPhrases = ['很棒的文章！', 'Get！', '不错不错', '支持一下', '写得很好', 'Mark', '顶一下', 'Interesting', 'Cool', '👍'];
    const randomPhrase = randomPhrases[Math.floor(Math.random() * randomPhrases.length)];
    const likeContent = `👍 已点赞 ${randomPhrase} <span style="display:none">[LIKE]</span>`;

    editor.setContent(likeContent);
    
    // Submit
    // Artalk's submit might trigger UI loading states which are hidden, that's fine.
    editor.submit();
    
    // Restore content? Usually submit clears it.
    // If submit is async, we might not need to restore.
    
    // Note: artalk.editor.submit() is async but returns void usually or promise depending on version.
    // Artalk will reload list automatically on success.
}

/**
 * Format date for WeChat style (Simple)
 */
function formatWeChatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) {
        return '刚刚';
    } else if (diff < hour) {
        return Math.floor(diff / minute) + '分钟前';
    } else if (diff < day) {
        return Math.floor(diff / hour) + '小时前';
    } else if (diff < 2 * day) {
        return '昨天';
    } else {
        // Month-Day
        return (date.getMonth() + 1) + '月' + date.getDate() + '日';
    }
}

/**
 * Render WeChat Feed Style Custom List
 * Takes Artalk Data and renders a pure DOM structure into the container.
 * Replacing the original Artalk List.
 */
function renderWeChatFeed(artalkInstance, container, comments) {
    // 1. Hide the original Artalk List and Editor
    const originalList = container.querySelector('.atk-list');
    const originalEditor = container.querySelector('.atk-main-editor');
    if (originalList) originalList.style.display = 'none';
    if (originalEditor) originalEditor.style.display = 'none';

    // 2. Find or Create our Custom Container
    let customContainer = container.querySelector('.wechat-custom-render');
    if (!customContainer) {
        customContainer = document.createElement('div');
        customContainer.className = 'wechat-custom-render';
        // Insert it where the list was (or at the end)
        container.appendChild(customContainer);
    } else {
        customContainer.innerHTML = ''; // Clear previous
    }

    // 3. Separate Likes and Comments
    const likeNicks = [];
    const normalComments = [];
    const commentMap = new Map();

    // First pass: Build Map and separate likes
    comments.forEach(c => {
        // Store for ID lookup
        commentMap.set(c.id, c.nick);

        // Check content for [LIKE] marker
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = c.content;
        const text = tempDiv.textContent.trim();
        const htmlContent = c.content || '';

        // Detect [LIKE] in text OR hidden span
        if (text === '[LIKE]' || text === '/like' || htmlContent.includes('[LIKE]')) {
            likeNicks.push(c.nick);
        } else {
            normalComments.push(c);
        }
    });

    // 4. Update the "Likes" Section
    // The Likes section should be INSIDE the container (.moment-comments-area) because that is the "bubble".
    // It should be at the top of the bubble.

    let likesArea = container.querySelector('.moment-likes');
    let hasLikes = false;

    // If not found, create it
    if (!likesArea) {
        likesArea = document.createElement('div');
        likesArea.className = 'moment-likes';
        
        // Create inner structure
        const icon = document.createElement('i');
        icon.className = 'ri-heart-line';
        likesArea.appendChild(icon);
        
        const listSpan = document.createElement('span');
        listSpan.className = 'moment-likes-list';
        likesArea.appendChild(listSpan);

        // Prepend to container (so it's above comments)
        container.prepend(likesArea);
    }

    const likesListSpan = likesArea.querySelector('.moment-likes-list');

    if (likeNicks.length > 0) {
        likesArea.style.display = 'flex'; 
        likesListSpan.textContent = likeNicks.join(', ');
        hasLikes = true;

        // Fix border if no comments follow
        if (normalComments.length === 0) {
            likesArea.style.borderBottom = 'none';
            likesArea.style.marginBottom = '0';
            likesArea.style.paddingBottom = '0';
        } else {
            likesArea.style.borderBottom = '';
            likesArea.style.marginBottom = '';
            likesArea.style.paddingBottom = '';
        }
    } else {
        likesArea.style.display = 'none';
    }

    // 5. Render Normal Comments
    let hasComments = false;
    if (normalComments.length > 0) {
        const listUl = document.createElement('div');
        listUl.className = 'wechat-comments-list';

        normalComments.forEach(c => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'wechat-comment-item';
            
            // Logic for Reply: "A reply B : Content"
            let replyTargetNick = null;
            
            // Prepare content for parsing
            const tempC = document.createElement('div');
            tempC.innerHTML = c.content;
            
            // Priority 0: Parse content for .atk-reply-at (Most reliable for Artalk)
            // Artalk usually inserts <span class="atk-reply-at">@Nick</span> at start of content
            const replyAtNode = tempC.querySelector('.atk-reply-at');
            if (replyAtNode) {
                let rText = replyAtNode.textContent.trim();
                // Remove '@' if present
                if (rText.startsWith('@')) {
                    rText = rText.substring(1);
                }
                replyTargetNick = rText;
                
                // CRITICAL: Remove the node from content so it doesn't duplicate
                replyAtNode.remove();
            }

            // Priority 1: Direct field (Artalk standard)
            if (!replyTargetNick && c.reply_nick) {
                replyTargetNick = c.reply_nick;
            } 
            // Priority 2: Nested object (Artalk 2.x some versions)
            else if (!replyTargetNick && c.reply_user && c.reply_user.nick) {
                replyTargetNick = c.reply_user.nick;
            }
            // Priority 3: UA data (sometimes stored here)
            else if (!replyTargetNick && c.ua && c.ua.reply_nick) {
                replyTargetNick = c.ua.reply_nick;
            }
            // Priority 4: Look up by rid/pid
            else if (!replyTargetNick && c.rid && c.rid !== 0) {
                // Try to find the parent comment
                // If pid exists, use it (direct parent), otherwise use rid (root)
                const targetId = c.pid || c.rid;
                if (commentMap.has(targetId)) {
                    replyTargetNick = commentMap.get(targetId);
                }
            }

            // Construct HTML
            
            // Nickname
            const nickSpan = document.createElement('span');
            nickSpan.className = 'wechat-nick';
            nickSpan.textContent = c.nick;
            itemDiv.appendChild(nickSpan);

            // Reply Logic
            if (replyTargetNick) {
                const replyText = document.createTextNode('回复');
                const targetSpan = document.createElement('span');
                targetSpan.className = 'wechat-nick';
                targetSpan.textContent = replyTargetNick;
                
                itemDiv.appendChild(replyText);
                itemDiv.appendChild(targetSpan);
            }

            // Colon (Always present before content)
            const colonSpan = document.createElement('span');
            colonSpan.className = 'wechat-colon';
            colonSpan.textContent = ' : ';
            itemDiv.appendChild(colonSpan);

            // Content
            const contentSpan = document.createElement('span');
            contentSpan.className = 'wechat-content';
            
            // Unwrap <p>
            const ps = tempC.querySelectorAll('p');
            if (ps.length > 0) {
               ps.forEach(p => {
                   const s = document.createElement('span');
                   s.innerHTML = p.innerHTML;
                   p.replaceWith(s);
               });
            }
            contentSpan.innerHTML = tempC.innerHTML;
            
            itemDiv.appendChild(contentSpan);

            // Time (WeChat style: small gray text on right)
            if (c.date) {
                const timeSpan = document.createElement('span');
                timeSpan.className = 'wechat-time';
                timeSpan.textContent = formatWeChatTime(c.date);
                itemDiv.appendChild(timeSpan);
            }
            
            listUl.appendChild(itemDiv);
        });

        customContainer.appendChild(listUl);
        hasComments = true;
    }

    // 6. Handle Container Visibility (Empty State)
    if (!hasLikes && !hasComments) {
        container.style.display = 'none';
    } else {
        // Show with animation (was display:none in CSS)
        container.style.display = 'block';
        container.style.animation = 'fadeIn 0.3s ease-out';
    }
}


/**
 * Process Artalk list to match WeChat Official Account style (Single Page)
 * Mainly filters out "Like" comments which shouldn't appear in the article comment list.
 */
function processWeChatStyle(container, isFeed) {
    if (isFeed) return; // Feed uses renderWeChatFeed instead

    // Wait for DOM to be ready (Artalk renders async)
    // We use a small timeout or assume this is called after list-loaded
    
    const items = container.querySelectorAll('.atk-item');
    
    items.forEach(item => {
        const contentEl = item.querySelector('.atk-content');
        if (!contentEl) return;

        const htmlContent = contentEl.innerHTML;
        const textContent = contentEl.textContent.trim();
        
        // Check for [LIKE] marker in text or hidden span
        const isLike = textContent === '[LIKE]' || 
                       textContent === '/like' || 
                       htmlContent.includes('[LIKE]');

        if (isLike) {
            item.style.display = 'none';
        }
    });
    
    // Also, we might want to change the "No Comments" text if empty
    const list = container.querySelector('.atk-list');
    if (list && list.children.length === 0) {
        // Artalk handles empty state, but if we hid everything, we might need to show something?
        // Usually Artalk shows "No comments" if data is empty. 
        // If data had only likes, Artalk thinks there are comments, but we hid them.
        // We should check visible items.
    }
}

// Old function replaced by processWeChatStyle
// function formatArtalkReplies(container, isFeed) { ... }

function initMoments() {
    // 1. Handle Text Expand/Collapse
    const posts = document.querySelectorAll('.moment-card');
    
    posts.forEach(card => {
        const textWrapper = card.querySelector('.moment-text-wrapper');
        if (!textWrapper) return;

        const textDiv = textWrapper.querySelector('.moment-text');
        const toggleBtn = textWrapper.querySelector('.text-toggle');

        if (textDiv && toggleBtn) {
            // Check overflow
            const isOverflowing = textDiv.scrollHeight > textDiv.clientHeight;
            
            if (isOverflowing) {
                toggleBtn.style.display = 'block';
            } else {
                toggleBtn.style.display = 'none';
            }

            // Click Handler
            toggleBtn.onclick = function() {
                const isCollapsed = textDiv.classList.contains('is-collapsed');
                if (isCollapsed) {
                    textDiv.classList.remove('is-collapsed');
                    toggleBtn.innerText = '收起';
                } else {
                    textDiv.classList.add('is-collapsed');
                    toggleBtn.innerText = '全文';
                }
            };
        }
    });

    // 2. Handle Action Menu (Popover)
    // Close all popovers when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.action-wrapper')) {
            document.querySelectorAll('.action-popover').forEach(el => {
                el.classList.remove('is-visible');
            });
        }
    });

    const actionWrappers = document.querySelectorAll('.action-wrapper');
    actionWrappers.forEach(wrapper => {
        const toggleBtn = wrapper.querySelector('.action-toggle');
        const popover = wrapper.querySelector('.action-popover');

        if (toggleBtn && popover) {
            toggleBtn.onclick = function(e) {
                e.stopPropagation(); // Prevent document click
                
                // Close others first
                document.querySelectorAll('.action-popover').forEach(el => {
                    if (el !== popover) el.classList.remove('is-visible');
                });

                // Toggle current
                popover.classList.toggle('is-visible');
            };
        }
    });
}