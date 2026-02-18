import * as d3 from 'd3';
import './style.css';

let allCommits = [];
let allBranches = [];
let hashToCommit = new Map();

async function fetchCommits() {
  const result = await window.gitopo.git.exec(
    'log --all --format="%H|%P|%ct|%s" --date-order -1000'
  );

  if (!result.success) {
    console.error('Failed to fetch commits:', result.error);
    return [];
  }

  const commits = [];
  const lines = result.output.trim().split('\n');

  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length >= 4) {
      const hash = parts[0];
      const parentsStr = parts[1];
      const timestamp = parseInt(parts[2], 10);
      const message = parts.slice(3).join('|');
      const parents = parentsStr.trim() ? parentsStr.trim().split(' ') : [];
      commits.push({ hash, parents, timestamp, message });
    }
  }

  commits.sort((a, b) => b.timestamp - a.timestamp);
  return commits;
}

async function fetchBranches() {
  const result = await window.gitopo.git.exec(
    'branch -a --format="%(refname:short) %(objectname)"'
  );

  if (!result.success) {
    console.error('Failed to fetch branches:', result.error);
    return [];
  }

  const branches = [];
  const lines = result.output.trim().split('\n');

  for (const line of lines) {
    const parts = line.trim().split(' ');
    if (parts.length >= 2) {
      const name = parts[0];
      const hash = parts[1];
      branches.push({ name, hash });
    }
  }

  return branches;
}

function populateBranchSelectors(branches) {
  const selectors = ['branch1', 'branch2', 'branch3'];
  const defaultBranch = branches.find(
    (b) => b.name === 'main' || b.name === 'master'
  );

  selectors.forEach((id, index) => {
    const select = document.getElementById(id);
    select.innerHTML = '';

    // Add empty option
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '----';
    select.appendChild(emptyOption);

    // Add branch options
    branches.forEach((branch) => {
      const option = document.createElement('option');
      option.value = branch.name;
      option.textContent = branch.name;
      select.appendChild(option);
    });

    // Set default for first selector
    if (index === 0 && defaultBranch) {
      select.value = defaultBranch.name;
    }

    select.addEventListener('change', () => renderGraph());
  });
}

function getFirstParentLineage(branchName) {
  const branch = allBranches.find((b) => b.name === branchName);
  if (!branch) return new Set();

  const lineage = new Set();
  let currentHash = branch.hash;

  while (currentHash) {
    lineage.add(currentHash);
    const commit = hashToCommit.get(currentHash);
    if (commit && commit.parents.length > 0) {
      currentHash = commit.parents[0]; // First parent only
    } else {
      break;
    }
  }

  return lineage;
}

// Find sub-branches: commits that branch off from mainline and merge back
function findSubBranches(lineage) {
  const subBranches = [];
  const processedCommits = new Set();

  // Find merge commits on the mainline
  for (const hash of lineage) {
    const commit = hashToCommit.get(hash);
    if (!commit || commit.parents.length < 2) continue;

    // For each non-first parent (merged branches)
    for (let i = 1; i < commit.parents.length; i++) {
      const mergedParent = commit.parents[i];
      if (processedCommits.has(mergedParent)) continue;

      // Trace back the merged branch to find all its commits
      const subBranchCommits = new Set();
      const toVisit = [mergedParent];

      while (toVisit.length > 0) {
        const currentHash = toVisit.pop();
        if (subBranchCommits.has(currentHash)) continue;
        if (lineage.has(currentHash)) continue; // Stop at mainline
        if (processedCommits.has(currentHash)) continue;

        const current = hashToCommit.get(currentHash);
        if (!current) continue;

        subBranchCommits.add(currentHash);
        processedCommits.add(currentHash);

        // Follow all parents
        for (const parentHash of current.parents) {
          if (!lineage.has(parentHash) && !subBranchCommits.has(parentHash)) {
            toVisit.push(parentHash);
          }
        }
      }

      if (subBranchCommits.size > 0) {
        // Verify this sub-branch only depends on mainline or itself
        let isValidSubBranch = true;
        for (const sbHash of subBranchCommits) {
          const sbCommit = hashToCommit.get(sbHash);
          if (!sbCommit) continue;
          for (const parentHash of sbCommit.parents) {
            if (
              !lineage.has(parentHash) &&
              !subBranchCommits.has(parentHash)
            ) {
              isValidSubBranch = false;
              break;
            }
          }
          if (!isValidSubBranch) break;
        }

        if (isValidSubBranch) {
          subBranches.push({
            mergeCommit: hash,
            commits: subBranchCommits,
          });
        }
      }
    }
  }

  return subBranches;
}

function getSelectedBranches() {
  const branches = [];
  ['branch1', 'branch2', 'branch3'].forEach((id) => {
    const select = document.getElementById(id);
    if (select && select.value) {
      branches.push(select.value);
    }
  });
  return branches;
}

function renderGraph() {
  const svg = d3.select('#graph');
  svg.selectAll('*').remove();

  const container = d3.select('#app');
  container.selectAll('.tooltip').remove();

  const controlsHeight = document.getElementById('controls').offsetHeight;
  const width = window.innerWidth;
  const height = window.innerHeight - controlsHeight;

  svg.attr('width', width).attr('height', height);

  const nodeRadius = 6;
  const nodeSpacingY = 30;
  const mainColumnWidth = 150;
  const subBranchOffset = 30; // Distance between main column and sub-branches
  const paddingTop = 50;
  const paddingLeft = 50;

  const selectedBranches = getSelectedBranches();

  // Calculate lineage and sub-branches for each selected branch
  const branchLineages = selectedBranches.map((name) => {
    const lineage = getFirstParentLineage(name);
    const subBranches = findSubBranches(lineage);
    return { name, lineage, subBranches };
  });

  // Build hash -> branch map
  const hashToBranches = new Map();
  allBranches.forEach((b) => {
    if (!hashToBranches.has(b.hash)) {
      hashToBranches.set(b.hash, []);
    }
    hashToBranches.get(b.hash).push(b.name);
  });

  // Assign commits to columns with sub-column offsets
  const commitColumn = new Map(); // hash -> { mainCol, subOffset }

  // First, assign all commits to "Other" by default
  allCommits.forEach((commit) => {
    commitColumn.set(commit.hash, {
      mainCol: branchLineages.length,
      subOffset: 0,
      isSubBranch: false,
    });
  });

  // Assign mainline commits
  branchLineages.forEach((branch, branchIndex) => {
    for (const hash of branch.lineage) {
      commitColumn.set(hash, {
        mainCol: branchIndex,
        subOffset: 0,
        isSubBranch: false,
      });
    }
  });

  // Assign sub-branch commits with collision detection
  let subBranchIdCounter = 0;
  branchLineages.forEach((branch, branchIndex) => {
    // Track which rows have which sub-offsets used
    const rowOffsetUsage = new Map(); // row -> Set of used offsets

    branch.subBranches.forEach((subBranch) => {
      const subBranchId = `sb-${subBranchIdCounter++}`;

      // Find rows occupied by this sub-branch
      const subBranchRows = [];
      subBranch.commits.forEach((hash) => {
        const globalIndex = allCommits.findIndex((c) => c.hash === hash);
        if (globalIndex >= 0) {
          subBranchRows.push(globalIndex);
        }
      });

      // Find minimum offset that doesn't collide
      let offset = 1;
      let hasCollision = true;

      while (hasCollision) {
        hasCollision = false;
        for (const row of subBranchRows) {
          const usedOffsets = rowOffsetUsage.get(row) || new Set();
          if (usedOffsets.has(offset)) {
            hasCollision = true;
            offset++;
            break;
          }
        }
      }

      // Mark these rows as using this offset
      for (const row of subBranchRows) {
        if (!rowOffsetUsage.has(row)) {
          rowOffsetUsage.set(row, new Set());
        }
        rowOffsetUsage.get(row).add(offset);
      }

      // Assign the offset to all commits in this sub-branch
      subBranch.commits.forEach((hash) => {
        commitColumn.set(hash, {
          mainCol: branchIndex,
          subOffset: offset,
          isSubBranch: true,
          subBranchId: subBranchId,
        });
      });
    });
  });

  // Calculate X positions for each main column (accounting for sub-branches)
  const columnStartX = new Map();
  let currentX = paddingLeft;

  for (let i = 0; i <= branchLineages.length; i++) {
    columnStartX.set(i, currentX);

    if (i < branchLineages.length) {
      // Find max sub-offset for this branch
      let maxOffset = 0;
      allCommits.forEach((commit) => {
        const col = commitColumn.get(commit.hash);
        if (col.mainCol === i && col.subOffset > maxOffset) {
          maxOffset = col.subOffset;
        }
      });
      currentX += mainColumnWidth + maxOffset * subBranchOffset;
    }
  }

  // Calculate positions
  const positions = new Map();

  allCommits.forEach((commit, globalIndex) => {
    const col = commitColumn.get(commit.hash);
    const baseX = columnStartX.get(col.mainCol);
    const x = baseX + col.subOffset * subBranchOffset;

    positions.set(commit.hash, {
      col: col.mainCol,
      subOffset: col.subOffset,
      row: globalIndex,
      x: x,
      y: paddingTop + globalIndex * nodeSpacingY,
      isSubBranch: col.isSubBranch,
      subBranchId: col.subBranchId || null,
    });
  });

  // Check if "Other" column has commits
  const hasOtherCommits = Array.from(commitColumn.values()).some(
    (col) => col.mainCol === branchLineages.length
  );

  // Create main group for zoom/pan
  const mainGroup = svg.append('g').attr('class', 'main-group');

  // Create tooltip
  const tooltip = container
    .append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);

  // Draw column headers
  branchLineages.forEach((branch, index) => {
    mainGroup
      .append('text')
      .attr('x', columnStartX.get(index))
      .attr('y', 25)
      .attr('fill', '#4fc3f7')
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .text(branch.name);
  });

  // "Other" column header
  if (hasOtherCommits) {
    mainGroup
      .append('text')
      .attr('x', columnStartX.get(branchLineages.length))
      .attr('y', 25)
      .attr('fill', '#888')
      .attr('font-size', '14px')
      .text('Other');
  }

  // Draw edges
  allCommits.forEach((commit) => {
    const childPos = positions.get(commit.hash);
    if (!childPos) return;

    commit.parents.forEach((parentHash) => {
      const parentPos = positions.get(parentHash);
      if (parentPos) {
        // Skip edges involving "Other" column
        if (childPos.col === branchLineages.length || parentPos.col === branchLineages.length) {
          return;
        }
        const x1 = childPos.x;
        const y1 = childPos.y;
        const x2 = parentPos.x;
        const y2 = parentPos.y;

        let pathD;
        if (x1 === x2) {
          // Same column: straight line
          pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
        } else {
          // Different columns: sigmoid-style bezier curve
          const midY = (y1 + y2) / 2;
          pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
        }

        // Determine sub-branch ID for this edge
        const edgeSubBranchId = childPos.subBranchId || parentPos.subBranchId || null;
        const isSubBranchEdge = childPos.isSubBranch || parentPos.isSubBranch;

        const path = mainGroup
          .append('path')
          .attr('d', pathD)
          .attr('fill', 'none')
          .attr('stroke', isSubBranchEdge ? '#555' : '#666')
          .attr('stroke-width', childPos.isSubBranch && parentPos.isSubBranch ? 1 : 1.5)
          .attr('stroke-opacity', 0.6)
          .attr('class', edgeSubBranchId ? `edge edge-${edgeSubBranchId}` : 'edge');

        // Add hover interaction for sub-branch edges
        if (edgeSubBranchId) {
          path
            .style('cursor', 'pointer')
            .on('mouseenter', () => {
              mainGroup.selectAll(`.edge-${edgeSubBranchId}`)
                .attr('stroke', '#4fc3f7')
                .attr('stroke-width', 2.5)
                .attr('stroke-opacity', 1);
            })
            .on('mouseleave', () => {
              mainGroup.selectAll(`.edge-${edgeSubBranchId}`)
                .attr('stroke', '#555')
                .attr('stroke-width', 1)
                .attr('stroke-opacity', 0.6);
            });
        }
      }
    });
  });

  // Draw nodes
  const nodes = mainGroup
    .selectAll('g.node')
    .data(allCommits)
    .enter()
    .append('g')
    .attr('class', 'node')
    .attr('transform', (d) => {
      const pos = positions.get(d.hash);
      return pos ? `translate(${pos.x}, ${pos.y})` : 'translate(-100, -100)';
    });

  nodes
    .append('circle')
    .attr('r', (d) => {
      const pos = positions.get(d.hash);
      if (pos.isSubBranch) return nodeRadius * 0.6;
      if (pos.col < branchLineages.length) return nodeRadius;
      return nodeRadius * 0.7;
    })
    .attr('fill', (d) => {
      const pos = positions.get(d.hash);
      if (pos.isSubBranch) return '#a0a0a0';
      if (pos.col < branchLineages.length) {
        return hashToBranches.has(d.hash) ? '#4fc3f7' : '#fff';
      }
      return '#888';
    })
    .attr('stroke', '#333')
    .attr('stroke-width', (d) => {
      const pos = positions.get(d.hash);
      if (pos.isSubBranch) return 1;
      return pos.col < branchLineages.length ? 2 : 1;
    })
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      const branchNames = hashToBranches.get(d.hash);
      const branchInfo = branchNames ? `[${branchNames.join(', ')}]<br/>` : '';
      const date = new Date(d.timestamp * 1000).toLocaleString();

      tooltip
        .html(
          `<strong>${d.hash.substring(0, 7)}</strong><br/>` +
            `${branchInfo}${d.message}<br/>` +
            `<span class="date">${date}</span>`
        )
        .style('left', event.pageX + 15 + 'px')
        .style('top', event.pageY - 10 + 'px')
        .style('opacity', 1);
    })
    .on('mousemove', (event) => {
      tooltip
        .style('left', event.pageX + 15 + 'px')
        .style('top', event.pageY - 10 + 'px');
    })
    .on('mouseleave', () => {
      tooltip.style('opacity', 0);
    });

  // Pan (scroll) behavior - no zoom
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;

  function updateTransform() {
    mainGroup.attr('transform', `translate(${panX}, ${panY})`);
  }

  // Mouse wheel scrolling
  svg.on('wheel', (event) => {
    event.preventDefault();
    panX -= event.deltaX;
    panY -= event.deltaY;
    updateTransform();
  });

  // Left-button drag scrolling
  svg.on('mousedown', (event) => {
    if (event.button === 0) {
      isDragging = true;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      panStartX = panX;
      panStartY = panY;
      event.preventDefault();
    }
  });

  svg.on('mousemove', (event) => {
    if (isDragging) {
      panX = panStartX + (event.clientX - dragStartX);
      panY = panStartY + (event.clientY - dragStartY);
      updateTransform();
    }
  });

  svg.on('mouseup', (event) => {
    if (event.button === 0) {
      isDragging = false;
    }
  });

  svg.on('mouseleave', () => {
    isDragging = false;
  });

  // Touch scrolling
  let touchStartX = 0;
  let touchStartY = 0;
  let touchPanStartX = 0;
  let touchPanStartY = 0;

  svg.on('touchstart', (event) => {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchPanStartX = panX;
      touchPanStartY = panY;
    }
  });

  svg.on('touchmove', (event) => {
    if (event.touches.length === 1) {
      event.preventDefault();
      const touch = event.touches[0];
      panX = touchPanStartX + (touch.clientX - touchStartX);
      panY = touchPanStartY + (touch.clientY - touchStartY);
      updateTransform();
    }
  });

  svg.on('contextmenu', (event) => {
    event.preventDefault();
  });
}

async function init() {
  [allCommits, allBranches] = await Promise.all([
    fetchCommits(),
    fetchBranches(),
  ]);

  // Build hash -> commit map
  hashToCommit.clear();
  allCommits.forEach((c) => hashToCommit.set(c.hash, c));

  console.log('Commits:', allCommits.length);
  console.log('Branches:', allBranches.length);

  populateBranchSelectors(allBranches);
  renderGraph();

  window.addEventListener('resize', () => {
    renderGraph();
  });
}

init();
