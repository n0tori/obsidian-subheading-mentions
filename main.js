/**
 * Obsidian Subheading Links Plugin
 * 
 * This plugin extends the Unlinked mentions in the right-side panel to include
 * subheadings from other notes in the same vault, not just note titles.
 * 
 * a little janky, but works 
 */

const obsidian = require('obsidian');

class SubheadingLinksPlugin extends obsidian.Plugin {
  async onload() {
    console.log('Loading Subheading Links Plugin');

    // Load default settings
    this.settings = Object.assign({
      includeHeadingLevels: [1, 2, 3],
      minHeadingTextLength: 3,
      excludeFolders: []
    }, await this.loadData());

    // Register event for when a file is opened
    this.registerEvent(
      this.app.workspace.on('file-open', this.handleFileOpen.bind(this))
    );

    // Add settings tab
    this.addSettingTab(new SubheadingLinksSettingTab(this.app, this));

    // Add the command to refresh subheading links manually
    this.addCommand({
      id: 'refresh-subheading-links',
      name: 'Refresh Subheading Links',
      callback: () => {
        const currentFile = this.app.workspace.getActiveFile();
        if (currentFile) {
          this.processUnlinkedSubheadingMentions(currentFile);
        }
      }
    });
    
    // Load styles from external CSS file
    this.loadStyles();
  }

  loadStyles() {
    // Load styles from the styles.css file in the plugin directory
    const styleEl = document.createElement('link');
    styleEl.rel = 'stylesheet';
    styleEl.href = this.app.vault.adapter.getResourcePath('plugins/obsidian-subheading-links/styles.css');
    styleEl.id = 'subheading-links-styles';
    document.head.appendChild(styleEl);
  }

  async handleFileOpen(file) {
    if (!file || file.extension !== 'md') return;
    
    // Allow some time for Obsidian to load the backlinks view
    setTimeout(() => this.processUnlinkedSubheadingMentions(file), 1000);
  }

  async processUnlinkedSubheadingMentions(currentFile) {
    try {
      // Get content of current file
      const currentFileContent = await this.app.vault.read(currentFile);
      
      // Find all possible text fragments to match against headings
      const possibleMentions = this.extractSignificantPhrases(currentFileContent);
      
      // Get all markdown files
      const markdownFiles = this.app.vault.getMarkdownFiles().filter(file => 
        file.path !== currentFile.path && 
        !this.isExcludedFile(file.path)
      );
  
      const subheadingMentions = await this.findSubheadingMentions(markdownFiles, possibleMentions);
  
      // Render the results in the sidebar
      this.displaySubheadingMentions(subheadingMentions, currentFile);
    } catch (error) {
      console.error("Error processing subheading mentions:", error);
    }
  }

  async findSubheadingMentions(markdownFiles, possibleMentions) {
    const subheadingMentions = [];

    // Process each file to extract headings and check for mentions
    for (const file of markdownFiles) {
      try {
        const fileContent = await this.app.vault.read(file);
        const headings = this.extractHeadings(fileContent);
        
        for (const heading of headings) {
          // Check if any significant phrase in the current note mentions this heading
          for (const phrase of possibleMentions) {
            if (this.isSignificantMention(phrase, heading.text)) {
              subheadingMentions.push({
                file: file,
                heading: heading,
                matchedPhrase: phrase
              });
              break; // Once we find a match for this heading, move on
            }
          }
        }
      } catch (error) {
        console.error(`Error processing file ${file.path}:`, error);
      }
    }

    return subheadingMentions;
  }

  extractHeadings(fileContent) {
    const headings = [];
    const lines = fileContent.split('\n');
    
    // Regular expression to match heading markers (# to ######)
    const headingRegex = /^(#{1,6})\s+(.+)$/;
    
    lines.forEach((line, lineNumber) => {
      const match = line.match(headingRegex);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        
        // Check if this heading level should be included
        if (this.settings.includeHeadingLevels.includes(level) && 
            text.length >= this.settings.minHeadingTextLength) {
          headings.push({
            text: text,
            level: level,
            lineNumber: lineNumber
          });
        }
      }
    });
    
    return headings;
  }
  
  extractSignificantPhrases(fileContent) {
    // This is a simplified implementation. A more sophisticated approach
    // might use NLP techniques for phrase extraction.
    const phrases = [];
    
    // Remove code blocks and YAML frontmatter
    const cleanedContent = fileContent
      .replace(/```[\s\S]*?```/g, '')
      .replace(/---[\s\S]*?---/g, '');
    
    // Split by sentences and then words
    const sentences = cleanedContent.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    for (const sentence of sentences) {
      // Extract meaningful phrases (3+ word sequences)
      const words = sentence.trim().split(/\s+/).filter(w => w.length > 2);
      
      if (words.length <= 1) continue;
      
      // Single words that might be significant
      words.forEach(word => {
        if (word.length >= 5) {
          phrases.push(word);
        }
      });
      
      // Bigrams (two-word phrases)
      for (let i = 0; i < words.length - 1; i++) {
        phrases.push(`${words[i]} ${words[i+1]}`);
      }
      
      // Trigrams (three-word phrases)
      for (let i = 0; i < words.length - 2; i++) {
        phrases.push(`${words[i]} ${words[i+1]} ${words[i+2]}`);
      }
    }
    
    // Remove duplicates and sort by length (longer phrases first)
    return [...new Set(phrases)].sort((a, b) => b.length - a.length);
  }
  
  isSignificantMention(phrase, headingText) {
    // Case-insensitive comparison
    phrase = phrase.toLowerCase();
    headingText = headingText.toLowerCase();
    
    // Consider it a match if:
    // 1. The phrase is at least 40% of the heading and 3+ characters
    // 2. The heading contains the full phrase
    return phrase.length >= 3 && 
           phrase.length >= headingText.length * 0.4 &&
           headingText.includes(phrase);
  }
  
  isExcludedFile(filePath) {
    // Check if the file is in an excluded folder
    return this.settings.excludeFolders.some(folder => 
      filePath.startsWith(folder)
    );
  }
  
  displaySubheadingMentions(mentions, currentFile) {
    // Find all backlink views and insert the mentions
    this.insertIntoBacklinksPane(mentions, currentFile);
  }
  
  insertIntoBacklinksPane(mentions, currentFile) {
    // Find all backlink views
    const backlinkViews = this.findBacklinkViews();
    
    if (!backlinkViews || backlinkViews.length === 0) {
      console.log("Subheading Links: Could not find backlinks view");
      return;
    }
    
    // For each backlinks view found
    for (const view of backlinkViews) {
      try {
        // Find the unlinked mentions section
        const unlinkedSectionTitle = this.findUnlinkedMentionsTitle(view.containerEl);
        
        if (!unlinkedSectionTitle) {
          console.log("Subheading Links: Could not find unlinked mentions section");
          continue;
        }
        
        // Find the parent of the unlinked mentions section
        const unlinkedSection = unlinkedSectionTitle.parentElement;
        
        // Remove existing subheading section if it exists
        const existingSection = unlinkedSection.querySelector('.subheading-section-container');
        if (existingSection) {
          existingSection.remove();
        }
        
        // Skip if no mentions found
        if (mentions.length === 0) continue;
        
        // Group mentions by file
        const mentionsByFile = this.groupMentionsByFile(mentions);
        
        // Create and insert the mentions UI
        this.createMentionsUI(mentionsByFile, unlinkedSection, currentFile);
      } catch (error) {
        console.error("Subheading Links Error:", error);
      }
    }
  }

  groupMentionsByFile(mentions) {
    const mentionsByFile = {};
    mentions.forEach(mention => {
      const filePath = mention.file.path;
      if (!mentionsByFile[filePath]) {
        mentionsByFile[filePath] = [];
      }
      mentionsByFile[filePath].push(mention);
    });
    return mentionsByFile;
  }

  createMentionsUI(mentionsByFile, unlinkedSection, currentFile) {
    // Create subheading section container
    const subheadingContainer = document.createElement('div');
    subheadingContainer.className = 'subheading-section-container';
    
    // Add subheading section header
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'subheading-section-header';
    sectionHeader.textContent = 'Unlinked Subheading Mentions';
    subheadingContainer.appendChild(sectionHeader);
    
    // Create list for file results
    const resultsList = document.createElement('div');
    resultsList.className = 'search-results-children';
    subheadingContainer.appendChild(resultsList);
    
    // Add files and their mentions
    for (const filePath in mentionsByFile) {
      // Create file container
      const fileItem = document.createElement('div');
      fileItem.className = 'search-result-file-title is-clickable';
      fileItem.textContent = this.getFilenameFromPath(filePath);
      fileItem.addEventListener('click', () => {
        this.app.workspace.openLinkText(filePath, currentFile.path, false);
      });
      resultsList.appendChild(fileItem);
      
      // Add mentions under this file
      this.addMentionItems(mentionsByFile[filePath], resultsList, currentFile);
    }
    
    // Insert after the unlinked mentions title
    unlinkedSection.appendChild(subheadingContainer);
  }

  addMentionItems(mentions, resultsList, currentFile) {
    mentions.forEach(mention => {
      const mentionItem = document.createElement('div');
      mentionItem.className = 'subheading-mention-item';
      
      // Create heading level indicator
      const levelIndicator = document.createElement('span');
      levelIndicator.className = 'subheading-heading-indicator';
      levelIndicator.textContent = '#'.repeat(mention.heading.level);
      mentionItem.appendChild(levelIndicator);
      
      // Create heading text
      const headingText = document.createElement('span');
      headingText.textContent = mention.heading.text;
      mentionItem.appendChild(headingText);
      
      // Add click handler to navigate to heading
      mentionItem.addEventListener('click', () => {
        this.app.workspace.openLinkText(
          `${mention.file.path}#${mention.heading.text}`, 
          currentFile.path, 
          false
        );
      });
      
      resultsList.appendChild(mentionItem);
    });
  }
  
  getFilenameFromPath(path) {
    // Extract filename without extension
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace('.md', '');
  }
  
  findUnlinkedMentionsTitle(container) {
    // This looks for the specific unlinked mentions title text
    const elements = container.querySelectorAll('div');
    
    for (const el of elements) {
      if (el.textContent === 'Unlinked mentions') {
        return el;
      }
    }
    
    return null;
  }
  
  findBacklinkViews() {
    // Find all leaf views of type 'backlink'
    return this.app.workspace.getLeavesOfType('backlink').map(leaf => leaf.view);
  }
  
  onunload() {
    console.log('Unloading Subheading Links Plugin');
    // Remove the CSS we added
    document.getElementById('subheading-links-styles')?.remove();
  }
}

class SubheadingLinksSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const {containerEl} = this;
    containerEl.empty();

    containerEl.createEl('h2', {text: 'Subheading Links Settings'});

    // Heading levels to include
    new obsidian.Setting(containerEl)
      .setName('Heading levels to include')
      .setDesc('Select which heading levels to include in unlinked mentions')
      .addDropdown(dropdown => {
        const options = {
          "1": "Level 1 only",
          "1,2": "Levels 1-2",
          "1,2,3": "Levels 1-3",
          "1,2,3,4": "Levels 1-4",
          "1,2,3,4,5,6": "All levels"
        };
        
        dropdown
          .addOptions(options)
          .setValue(this.plugin.settings.includeHeadingLevels.join(','))
          .onChange(async (value) => {
            this.plugin.settings.includeHeadingLevels = value.split(',').map(Number);
            await this.plugin.saveData(this.plugin.settings);
          });
      });

    // Minimum heading text length
    new obsidian.Setting(containerEl)
      .setName('Minimum heading length')
      .setDesc('Minimum number of characters a heading must have to be included')
      .addSlider(slider => slider
        .setLimits(2, 10, 1)
        .setValue(this.plugin.settings.minHeadingTextLength)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.minHeadingTextLength = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    // Excluded folders
    new obsidian.Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Folders to exclude from subheading search (one per line)')
      .addTextArea(text => text
        .setValue(this.plugin.settings.excludeFolders.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.excludeFolders = value.split('\n').filter(folder => folder.trim().length > 0);
          await this.plugin.saveData(this.plugin.settings);
        }));

    // Add a button to trigger manual refresh
    new obsidian.Setting(containerEl)
      .setName('Manual refresh')
      .setDesc('Refresh subheading links for the current note')
      .addButton(button => button
        .setButtonText('Refresh Now')
        .onClick(() => {
          const currentFile = this.plugin.app.workspace.getActiveFile();
          if (currentFile) {
            this.plugin.processUnlinkedSubheadingMentions(currentFile);
            new obsidian.Notice('Subheading links refreshed');
          } else {
            new obsidian.Notice('No active file');
          }
        }));
  }
}

module.exports = SubheadingLinksPlugin;