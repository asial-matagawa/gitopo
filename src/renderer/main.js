import * as d3 from 'd3';
import './style.css';

let allCommits = [];
let allBranches = [];
let allPullRequests = [];
let hashToCommit = new Map();
let repoName = '';
let timeZoom = 1; // Time axis zoom factor
let config = {}; // Config from package.json

function showLoading(message) {
  const loading = document.getElementById('loading');
  const status = document.getElementById('loading-status');
  loading.classList.remove('hidden');
  status.textContent = message;
}

function hideLoading() {
  const loading = document.getElementById('loading');
  loading.classList.add('hidden');
}

async function fetchRepoName() {
  const result = await window.gitopo.git.exec('rev-parse --show-toplevel');
  if (result.success) {
    const fullPath = result.output.trim();
    return fullPath.split('/').pop() || fullPath;
  }
  return 'Unknown Repository';
}

async function fetchConfig() {
  const result = await window.gitopo.config.get();
  if (result.success) {
    return result.config;
  }
  console.error('Failed to fetch config:', result.error);
  return {};
}

async function fetchPullRequests() {
  const result = await window.gitopo.gh.exec(
    'pr list --state open --json number,title,headRefName,headRefOid'
  );

  if (!result.success) {
    console.error('Failed to fetch pull requests:', result.error);
    return [];
  }

  try {
    const prs = JSON.parse(result.output);
    return prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName,
      headCommit: pr.headRefOid,
    }));
  } catch (e) {
    console.error('Failed to parse PR data:', e);
    return [];
  }
}

function getCommitLimit() {
  const input = document.getElementById('commit-limit');
  const value = parseInt(input.value, 10);
  if (isNaN(value) || value < 1 || value > 100000000) {
    return 1000; // Default fallback
  }
  return value;
}

async function fetchCommits(limit = 1000) {
  const result = await window.gitopo.git.exec(
    `log --all --format="%H|%P|%ct|%s" --date-order -${limit}`
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
  const keyBranches = config.keyBranches || [];

  // Fallback to main/master if no keyBranches configured
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

    // Set default from keyBranches config, fallback to main/master for first selector
    if (keyBranches[index]) {
      const configuredBranch = branches.find((b) => b.name === keyBranches[index]);
      if (configuredBranch) {
        select.value = configuredBranch.name;
      }
    } else if (index === 0 && defaultBranch) {
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

// Find sub-branches: commits that branch off from mainline
// A sub-branch belongs to key branch A if:
// - Its last commit is merged into A, OR
// - Its last commit is not merged into any key branch (unmerged)
// excludeCommits: commits that belong to other selected branches' lineages
// allKeyBranchLineages: array of all key branch lineages for checking merges
function findSubBranches(lineage, excludeCommits = new Set(), allKeyBranchLineages = []) {
  const subBranches = [];
  const processedCommits = new Set();

  // Build child links (reverse of parent links)
  const hashToChildren = new Map();
  for (const commit of allCommits) {
    for (const parentHash of commit.parents) {
      if (!hashToChildren.has(parentHash)) {
        hashToChildren.set(parentHash, []);
      }
      hashToChildren.get(parentHash).push(commit.hash);
    }
  }

  // Helper: collect connected commits (both parents and children) starting from a given hash
  function collectConnectedCommits(startHash) {
    const commits = new Set();
    const toVisit = [startHash];

    while (toVisit.length > 0) {
      const currentHash = toVisit.pop();
      if (commits.has(currentHash)) continue;
      if (lineage.has(currentHash)) continue;
      if (excludeCommits.has(currentHash)) continue;
      if (processedCommits.has(currentHash)) continue;

      const current = hashToCommit.get(currentHash);
      if (!current) continue;

      commits.add(currentHash);

      // Follow all parents (excluding mainline and other lineages)
      for (const parentHash of current.parents) {
        if (!lineage.has(parentHash) && !excludeCommits.has(parentHash) && !commits.has(parentHash)) {
          toVisit.push(parentHash);
        }
      }

      // Follow all children (excluding mainline and other lineages)
      const children = hashToChildren.get(currentHash) || [];
      for (const childHash of children) {
        if (!lineage.has(childHash) && !excludeCommits.has(childHash) && !commits.has(childHash)) {
          toVisit.push(childHash);
        }
      }
    }

    return commits;
  }

  // Helper: check if a commit set only depends on mainline or itself
  function isValidSubBranch(commitSet) {
    for (const hash of commitSet) {
      const commit = hashToCommit.get(hash);
      if (!commit) continue;
      for (const parentHash of commit.parents) {
        if (!lineage.has(parentHash) && !commitSet.has(parentHash)) {
          return false;
        }
      }
    }
    return true;
  }

  // Helper: find merge commit on a specific lineage for a sub-branch (if any)
  function findMergeCommitOnLineage(commitSet, targetLineage) {
    for (const hash of targetLineage) {
      const commit = hashToCommit.get(hash);
      if (!commit || commit.parents.length < 2) continue;
      for (let i = 1; i < commit.parents.length; i++) {
        if (commitSet.has(commit.parents[i])) {
          return hash;
        }
      }
    }
    return null;
  }

  // Helper: find branch point (the commit on lineage where sub-branch forks from)
  function findBranchPoint(commitSet) {
    for (const hash of commitSet) {
      const commit = hashToCommit.get(hash);
      if (!commit) continue;
      for (const parentHash of commit.parents) {
        if (lineage.has(parentHash)) {
          return parentHash;
        }
      }
    }
    return null;
  }

  // Find all non-mainline commits and group them into connected components
  for (const commit of allCommits) {
    if (lineage.has(commit.hash)) continue;
    if (excludeCommits.has(commit.hash)) continue;
    if (processedCommits.has(commit.hash)) continue;

    const subBranchCommits = collectConnectedCommits(commit.hash);

    if (subBranchCommits.size > 0 && isValidSubBranch(subBranchCommits)) {
      // Check where this sub-branch is merged
      const mergeOnThisLineage = findMergeCommitOnLineage(subBranchCommits, lineage);

      // Check if merged into any other key branch
      let mergedIntoOtherKeyBranch = false;
      for (const otherLineage of allKeyBranchLineages) {
        if (otherLineage === lineage) continue;
        if (findMergeCommitOnLineage(subBranchCommits, otherLineage)) {
          mergedIntoOtherKeyBranch = true;
          break;
        }
      }

      // Include this sub-branch if:
      // - It's merged into this lineage, OR
      // - It's not merged into any key branch (unmerged)
      if (mergeOnThisLineage || !mergedIntoOtherKeyBranch) {
        subBranchCommits.forEach((h) => processedCommits.add(h));
        subBranches.push({
          mergeCommit: mergeOnThisLineage,
          branchPoint: findBranchPoint(subBranchCommits),
          commits: subBranchCommits,
        });
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

  // First, calculate all lineages
  const allLineages = selectedBranches.map((name) => ({
    name,
    lineage: getFirstParentLineage(name),
  }));

  // Build a set of all lineage commits (to exclude from sub-branch detection)
  const allLineageCommits = new Set();
  allLineages.forEach(({ lineage }) => {
    lineage.forEach((hash) => allLineageCommits.add(hash));
  });

  // Collect all lineages for sub-branch merge detection
  const allLineageSets = allLineages.map(({ lineage }) => lineage);

  // Calculate sub-branches for each selected branch, excluding other lineages
  const branchLineages = allLineages.map(({ name, lineage }) => {
    // Exclude commits from other lineages (not this one)
    const otherLineageCommits = new Set();
    allLineages.forEach((other) => {
      if (other.name !== name) {
        other.lineage.forEach((hash) => otherLineageCommits.add(hash));
      }
    });

    const subBranches = findSubBranches(lineage, otherLineageCommits, allLineageSets);
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
  // Use span from branch point (inclusive) to merge commit or last commit (inclusive)
  let subBranchIdCounter = 0;
  branchLineages.forEach((branch, branchIndex) => {
    // Track which rows have which sub-offsets used
    const rowOffsetUsage = new Map(); // row -> Set of used offsets

    // Calculate span for each sub-branch
    const subBranchesWithSpan = branch.subBranches.map((subBranch) => {
      // Find start row (branch point on mainline)
      let startRow = -1;
      if (subBranch.branchPoint) {
        startRow = allCommits.findIndex((c) => c.hash === subBranch.branchPoint);
      }
      // Fallback: use oldest commit in sub-branch
      if (startRow < 0) {
        let oldestTimestamp = -Infinity;
        subBranch.commits.forEach((hash) => {
          const commit = hashToCommit.get(hash);
          if (commit && commit.timestamp > oldestTimestamp) {
            oldestTimestamp = commit.timestamp;
            startRow = allCommits.findIndex((c) => c.hash === hash);
          }
        });
      }

      // Find end row (merge commit on mainline, or newest commit in sub-branch if unmerged)
      let endRow = -1;
      if (subBranch.mergeCommit) {
        endRow = allCommits.findIndex((c) => c.hash === subBranch.mergeCommit);
      } else {
        // Unmerged: use newest commit (highest timestamp = lowest row index)
        let newestTimestamp = Infinity;
        subBranch.commits.forEach((hash) => {
          const commit = hashToCommit.get(hash);
          if (commit && commit.timestamp < newestTimestamp) {
            newestTimestamp = commit.timestamp;
            endRow = allCommits.findIndex((c) => c.hash === hash);
          }
        });
      }

      return { ...subBranch, startRow, endRow };
    });

    // Sort sub-branches by their branch point timestamp (older first = higher row index first)
    const sortedSubBranches = [...subBranchesWithSpan].sort((a, b) => {
      return b.startRow - a.startRow; // Higher row index (older) first
    });

    sortedSubBranches.forEach((subBranch) => {
      const subBranchId = `sb-${subBranchIdCounter++}`;

      // Calculate span rows (from end to start, since end is newer = lower row index)
      // Start is inclusive, end is exclusive
      const spanStart = Math.min(subBranch.startRow, subBranch.endRow);
      const spanEnd = Math.max(subBranch.startRow, subBranch.endRow);

      // Find minimum offset that doesn't collide with existing sub-branches in the span
      let offset = 1;
      let hasCollision = true;

      while (hasCollision) {
        hasCollision = false;
        for (let row = spanStart; row < spanEnd; row++) {
          const usedOffsets = rowOffsetUsage.get(row) || new Set();
          if (usedOffsets.has(offset)) {
            hasCollision = true;
            offset++;
            break;
          }
        }
      }

      // Mark all rows in the span as using this offset (end exclusive)
      for (let row = spanStart; row < spanEnd; row++) {
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

  // Create header group (follows panX only, not panY or timeZoom)
  const headerGroup = svg.append('g').attr('class', 'header-group');

  // Create tooltip
  const tooltip = container
    .append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);

  // Branch colors (standard 3 colors)
  const branchColors = ['#4CAF50', '#2196F3', '#FF9800']; // Green, Blue, Orange

  // Header Y position (fixed)
  const headerY = 20;

  // Draw column headers (in headerGroup, centered on column)
  branchLineages.forEach((branch, index) => {
    headerGroup
      .append('text')
      .attr('x', columnStartX.get(index))
      .attr('y', headerY)
      .attr('text-anchor', 'middle')
      .attr('fill', branchColors[index] || '#888')
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .text(branch.name);
  });

  // "Other" column header
  if (hasOtherCommits) {
    headerGroup
      .append('text')
      .attr('x', columnStartX.get(branchLineages.length))
      .attr('y', headerY)
      .attr('text-anchor', 'middle')
      .attr('fill', '#888')
      .attr('font-size', '14px')
      .text('Other');
  }

  // Build child links map (parent -> children)
  const hashToChildren = new Map();
  allCommits.forEach((commit) => {
    commit.parents.forEach((parentHash) => {
      if (!hashToChildren.has(parentHash)) {
        hashToChildren.set(parentHash, []);
      }
      hashToChildren.get(parentHash).push(commit.hash);
    });
  });

  // Build set of key branch lineage commits
  const keyBranchCommits = new Set();
  branchLineages.forEach((branch) => {
    branch.lineage.forEach((hash) => keyBranchCommits.add(hash));
  });

  // Function to find edges connecting an Other commit to key branches
  function findConnectingEdges(startHash) {
    const edges = [];
    const visited = new Set();

    // Traverse parents (upward)
    function traverseParents(hash) {
      if (visited.has(hash)) return;
      visited.add(hash);

      const commit = hashToCommit.get(hash);
      if (!commit) return;

      commit.parents.forEach((parentHash) => {
        edges.push({ source: hash, target: parentHash });
        const parentPos = positions.get(parentHash);
        // Continue if parent is also in Other column
        if (parentPos && parentPos.col === branchLineages.length && !parentPos.isSubBranch) {
          traverseParents(parentHash);
        }
      });
    }

    // Traverse children (downward)
    function traverseChildren(hash) {
      if (visited.has(hash)) return;
      visited.add(hash);

      const children = hashToChildren.get(hash) || [];
      children.forEach((childHash) => {
        edges.push({ source: childHash, target: hash });
        const childPos = positions.get(childHash);
        // Continue if child is also in Other column
        if (childPos && childPos.col === branchLineages.length && !childPos.isSubBranch) {
          traverseChildren(childHash);
        }
      });
    }

    traverseParents(startHash);
    visited.delete(startHash); // Allow traversing children from start
    traverseChildren(startHash);

    return edges;
  }

  // Draw edges
  allCommits.forEach((commit) => {
    const childPos = positions.get(commit.hash);
    if (!childPos) return;

    commit.parents.forEach((parentHash) => {
      const parentPos = positions.get(parentHash);
      if (parentPos) {
        const isOtherEdge = childPos.col === branchLineages.length || parentPos.col === branchLineages.length;

        const x1 = childPos.x;
        const y1 = childPos.y * timeZoom;
        const x2 = parentPos.x;
        const y2 = parentPos.y * timeZoom;

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
        const isMainlineEdge = !isSubBranchEdge && !isOtherEdge && childPos.col < branchLineages.length;

        // Determine edge color based on branch
        let edgeColor = '#666';
        if (isOtherEdge) {
          edgeColor = '#444';
        } else if (childPos.col < branchLineages.length) {
          edgeColor = branchColors[childPos.col] || '#666';
        }

        // Determine stroke width
        let strokeWidth = 1.5;
        if (isOtherEdge) {
          strokeWidth = 1;
        } else if (isMainlineEdge) {
          strokeWidth = 3; // Thicker for mainline
        } else if (isSubBranchEdge) {
          strokeWidth = 1.5;
        }

        const path = mainGroup
          .append('path')
          .attr('d', pathD)
          .attr('fill', 'none')
          .attr('stroke', edgeColor)
          .attr('stroke-width', strokeWidth)
          .attr('stroke-opacity', isOtherEdge ? 0.4 : (isSubBranchEdge ? 0.5 : 0.8))
          .attr('stroke-dasharray', isOtherEdge ? '4,4' : 'none')
          .attr('class', edgeSubBranchId ? `edge edge-${edgeSubBranchId}` : 'edge')
          .attr('data-source', commit.hash)
          .attr('data-target', parentHash);

        // Add hover interaction for sub-branch edges (thicken only, no color change)
        if (edgeSubBranchId) {
          const originalWidth = strokeWidth;
          path
            .style('cursor', 'pointer')
            .on('mouseenter', () => {
              mainGroup.selectAll(`.edge-${edgeSubBranchId}`)
                .attr('stroke-width', 3)
                .attr('stroke-opacity', 0.9);
            })
            .on('mouseleave', () => {
              mainGroup.selectAll(`.edge-${edgeSubBranchId}`)
                .attr('stroke-width', originalWidth)
                .attr('stroke-opacity', 0.5);
            });
        }
      }
    });
  });

  // Build PR map (headCommit -> PR info)
  const hashToPR = new Map();
  allPullRequests.forEach((pr) => {
    hashToPR.set(pr.headCommit, pr);
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
      return pos ? `translate(${pos.x}, ${pos.y * timeZoom})` : 'translate(-100, -100)';
    });

  // Draw PR highlight circle (behind the main node)
  nodes
    .filter((d) => hashToPR.has(d.hash))
    .append('circle')
    .attr('r', nodeRadius + 6)
    .attr('fill', 'none')
    .attr('stroke', '#888')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '3,2');

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
      if (pos.col < branchLineages.length) {
        return branchColors[pos.col] || '#fff';
      }
      if (pos.isSubBranch) return '#a0a0a0';
      return '#888';
    })
    .attr('stroke', (d) => {
      const pos = positions.get(d.hash);
      if (pos.col < branchLineages.length) {
        return branchColors[pos.col] || '#333';
      }
      return '#333';
    })
    .attr('stroke-width', (d) => {
      const pos = positions.get(d.hash);
      if (pos.isSubBranch) return 1;
      return pos.col < branchLineages.length ? 2 : 1;
    })
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      const branchNames = hashToBranches.get(d.hash);
      const branchInfo = branchNames ? `[${branchNames.join(', ')}]<br/>` : '';
      const pr = hashToPR.get(d.hash);
      const prInfo = pr ? `<span class="pr-info">PR #${pr.number}: ${pr.title}</span><br/>` : '';
      const date = new Date(d.timestamp * 1000).toLocaleString();

      tooltip
        .html(
          `<strong>${d.hash.substring(0, 7)}</strong><br/>` +
            `${prInfo}${branchInfo}${d.message}<br/>` +
            `<span class="date">${date}</span>`
        )
        .style('left', event.pageX + 15 + 'px')
        .style('top', event.pageY - 10 + 'px')
        .style('opacity', 1);

      // Highlight connecting edges for Other column commits (not in sub-branches)
      const pos = positions.get(d.hash);
      if (pos && pos.col === branchLineages.length && !pos.isSubBranch) {
        const connectingEdges = findConnectingEdges(d.hash);
        connectingEdges.forEach(({ source, target }) => {
          mainGroup.selectAll(`path.edge[data-source="${source}"][data-target="${target}"]`)
            .attr('stroke-width', 3)
            .attr('stroke-opacity', 0.9);
        });
      }
    })
    .on('mousemove', (event) => {
      tooltip
        .style('left', event.pageX + 15 + 'px')
        .style('top', event.pageY - 10 + 'px');
    })
    .on('mouseleave', (event, d) => {
      tooltip.style('opacity', 0);

      // Reset edge highlighting for Other column commits
      const pos = positions.get(d.hash);
      if (pos && pos.col === branchLineages.length && !pos.isSubBranch) {
        const connectingEdges = findConnectingEdges(d.hash);
        connectingEdges.forEach(({ source, target }) => {
          mainGroup.selectAll(`path.edge[data-source="${source}"][data-target="${target}"]`)
            .attr('stroke-width', 1)
            .attr('stroke-opacity', 0.4);
        });
      }
    });

  // Draw PR labels next to nodes
  nodes
    .filter((d) => hashToPR.has(d.hash))
    .append('text')
    .attr('x', nodeRadius + 10)
    .attr('y', 4)
    .attr('fill', '#ccc')
    .attr('font-size', '11px')
    .text((d) => {
      const pr = hashToPR.get(d.hash);
      return `PR #${pr.number}: ${pr.title.substring(0, 30)}${pr.title.length > 30 ? '...' : ''}`;
    });

  // Pan and zoom behavior
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;

  // Helper to get zoomed Y position
  function getZoomedY(baseY) {
    return baseY * timeZoom;
  }

  function updateTransform() {
    mainGroup.attr('transform', `translate(${panX}, ${panY})`);
    // Header follows horizontal pan only
    headerGroup.attr('transform', `translate(${panX}, 0)`);
  }

  // Update node and edge positions based on timeZoom
  function updatePositions() {
    // Update node positions
    mainGroup.selectAll('g.node').attr('transform', (d) => {
      const pos = positions.get(d.hash);
      return pos ? `translate(${pos.x}, ${getZoomedY(pos.y)})` : 'translate(-100, -100)';
    });

    // Update edge paths
    mainGroup.selectAll('path.edge').attr('d', function () {
      const edge = d3.select(this);
      const sourceHash = edge.attr('data-source');
      const targetHash = edge.attr('data-target');
      const sourcePos = positions.get(sourceHash);
      const targetPos = positions.get(targetHash);

      if (!sourcePos || !targetPos) return '';

      const x1 = sourcePos.x;
      const y1 = getZoomedY(sourcePos.y);
      const x2 = targetPos.x;
      const y2 = getZoomedY(targetPos.y);

      if (x1 === x2) {
        return `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        const midY = (y1 + y2) / 2;
        return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      }
    });
  }

  // Mouse wheel scrolling and zooming
  svg.on('wheel', (event) => {
    event.preventDefault();

    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd + scroll: vertical zoom (time axis)
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      const minZoom = 0.1;
      const maxZoom = 5;

      const newTimeZoom = Math.max(minZoom, Math.min(maxZoom, timeZoom * zoomFactor));

      // Zoom centered on mouse Y position
      const rect = svg.node().getBoundingClientRect();
      const mouseY = event.clientY - rect.top;

      // Adjust panY to keep mouse position stable
      const graphY = mouseY - panY;
      panY = mouseY - graphY * (newTimeZoom / timeZoom);
      timeZoom = newTimeZoom;

      updatePositions();
      updateTransform();
    } else {
      // Normal scroll: pan
      panX -= event.deltaX;
      panY -= event.deltaY;
      updateTransform();
    }
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

async function reloadCommits() {
  showLoading('Loading commits...');
  const limit = getCommitLimit();
  allCommits = await fetchCommits(limit);

  // Rebuild hash -> commit map
  hashToCommit.clear();
  allCommits.forEach((c) => hashToCommit.set(c.hash, c));

  console.log('Commits reloaded:', allCommits.length);

  showLoading('Rendering graph...');
  renderGraph();
  hideLoading();
}

async function refresh() {
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.classList.add('refreshing');

  try {
    const limit = getCommitLimit();

    showLoading('Fetching from remotes...');
    await window.gitopo.git.exec('fetch --all');

    showLoading('Loading commits...');
    allCommits = await fetchCommits(limit);

    showLoading('Loading branches...');
    allBranches = await fetchBranches();

    showLoading('Loading pull requests...');
    allPullRequests = await fetchPullRequests();

    // Rebuild hash -> commit map
    hashToCommit.clear();
    allCommits.forEach((c) => hashToCommit.set(c.hash, c));

    // Re-populate branch selectors (preserve current selections)
    const currentSelections = ['branch1', 'branch2', 'branch3'].map((id) => {
      return document.getElementById(id).value;
    });

    populateBranchSelectors(allBranches);

    // Restore selections
    ['branch1', 'branch2', 'branch3'].forEach((id, index) => {
      const select = document.getElementById(id);
      if (currentSelections[index] && allBranches.some((b) => b.name === currentSelections[index])) {
        select.value = currentSelections[index];
      }
    });

    console.log('Refreshed - Commits:', allCommits.length, 'Branches:', allBranches.length, 'PRs:', allPullRequests.length);

    showLoading('Rendering graph...');
    renderGraph();
    hideLoading();
  } finally {
    refreshBtn.classList.remove('refreshing');
  }
}

async function init() {
  const limit = getCommitLimit();

  // Get and display version
  const versionResult = await window.gitopo.app.getVersion();
  if (versionResult.success) {
    document.title = `gitopo ${versionResult.version}`;
  }

  showLoading('Loading repository info...');
  repoName = await fetchRepoName();

  showLoading('Loading configuration...');
  config = await fetchConfig();

  showLoading('Loading commits...');
  allCommits = await fetchCommits(limit);

  showLoading('Loading branches...');
  allBranches = await fetchBranches();

  showLoading('Loading pull requests...');
  allPullRequests = await fetchPullRequests();

  // Display repository name
  document.getElementById('repo-name').textContent = repoName;

  // Build hash -> commit map
  hashToCommit.clear();
  allCommits.forEach((c) => hashToCommit.set(c.hash, c));

  console.log('Repository:', repoName);
  console.log('Commits:', allCommits.length);
  console.log('Branches:', allBranches.length);
  console.log('Open PRs:', allPullRequests.length);
  console.log('Config:', config);

  populateBranchSelectors(allBranches);

  showLoading('Rendering graph...');
  renderGraph();

  hideLoading();

  window.addEventListener('resize', () => {
    renderGraph();
  });

  // Commit limit input handler with validation
  const commitLimitInput = document.getElementById('commit-limit');
  commitLimitInput.addEventListener('change', () => {
    const value = parseInt(commitLimitInput.value, 10);
    if (isNaN(value) || value < 1 || value > 100000000) {
      commitLimitInput.value = 1000; // Reset to default
    }
    reloadCommits();
  });

  // Refresh button handler
  document.getElementById('refresh-btn').addEventListener('click', refresh);

  // Keyboard shortcut: Ctrl+R / Cmd+R for refresh
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
      event.preventDefault();
      refresh();
    }
  });
}

init();
