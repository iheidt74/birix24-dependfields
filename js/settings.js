/**
 * Einstellungsseite - Abhängige Felder Plugin
 * Konfiguration der Feld-Abhängigkeiten
 */

const Settings = {
    currentEntityType: 'deal',
    configs: { configs: [] },
    fields: {},
    enumFields: {},
    allEntityTypes: {},
    editingConfigId: null,

    /**
     * Initialisierung
     */
    async init() {
        this.showLoading(true);

        try {
            // Smart Processes laden
            await B24.loadSmartProcessTypes();
            this.allEntityTypes = B24.getAllEntityTypes();

            // Entity-Typ Tabs rendern
            this.renderEntityTabs();

            // Erste Entity-Typ Daten laden
            await this.switchEntityType('deal');

        } catch (error) {
            this.showError('Fehler beim Laden: ' + (error.message || error));
            console.error(error);
        }

        this.showLoading(false);
    },

    /**
     * Entity-Typ Tabs rendern
     */
    renderEntityTabs() {
        const tabsContainer = document.getElementById('entityTabs');
        tabsContainer.innerHTML = '';

        for (const [key, config] of Object.entries(this.allEntityTypes)) {
            const tab = document.createElement('button');
            tab.className = 'tab' + (key === this.currentEntityType ? ' active' : '');
            tab.textContent = config.label;
            tab.dataset.entityType = key;
            tab.addEventListener('click', () => this.switchEntityType(key));
            tabsContainer.appendChild(tab);
        }
    },

    /**
     * Entity-Typ wechseln
     */
    async switchEntityType(entityType) {
        this.currentEntityType = entityType;
        this.editingConfigId = null;

        // Tabs aktualisieren
        document.querySelectorAll('#entityTabs .tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.entityType === entityType);
        });

        this.showLoading(true);

        try {
            // Felder und Konfiguration parallel laden
            const [fields, config] = await Promise.all([
                B24.getFields(entityType),
                B24.loadConfig(entityType)
            ]);

            this.fields = fields;
            this.enumFields = {};
            for (const [fieldId, field] of Object.entries(fields)) {
                if (field.type === 'enumeration' || field.type === 'crm_status' || field.type === 'boolean') {
                    this.enumFields[fieldId] = field;
                }
            }

            this.configs = config || { configs: [] };
            this.renderConfigList();

        } catch (error) {
            this.showError('Fehler beim Laden der Felder: ' + (error.message || error));
            console.error(error);
        }

        this.showLoading(false);
    },

    /**
     * Konfigurationsliste rendern
     */
    renderConfigList() {
        const container = document.getElementById('configContainer');
        const editorEl = document.getElementById('configEditor');
        editorEl.style.display = 'none';

        if (!this.configs.configs || this.configs.configs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">&#9881;</div>
                    <h3>Keine Konfigurationen</h3>
                    <p>Erstellen Sie eine neue Konfiguration für abhängige Felder.</p>
                </div>`;
        } else {
            container.innerHTML = this.configs.configs.map(cfg => `
                <div class="config-card" data-id="${cfg.id}">
                    <div class="config-card-header">
                        <div class="config-card-info">
                            <h3>${this.escapeHtml(cfg.name)}</h3>
                            <p>Startfeld: <strong>${this.getFieldLabel(cfg.rootField)}</strong></p>
                            <p class="config-meta">${this.countRules(cfg.rules)} Regel(n) konfiguriert</p>
                        </div>
                        <div class="config-card-actions">
                            <button class="btn btn-sm btn-primary" onclick="Settings.editConfig('${cfg.id}')">
                                Bearbeiten
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="Settings.deleteConfig('${cfg.id}')">
                                Löschen
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    },

    /**
     * Neue Konfiguration erstellen
     */
    addConfig() {
        const newConfig = {
            id: B24.generateId(),
            name: 'Neue Konfiguration',
            rootField: '',
            rules: {}
        };

        if (!this.configs.configs) {
            this.configs.configs = [];
        }
        this.configs.configs.push(newConfig);
        this.editConfig(newConfig.id);
    },

    /**
     * Konfiguration bearbeiten
     */
    editConfig(configId) {
        this.editingConfigId = configId;
        const config = this.configs.configs.find(c => c.id === configId);
        if (!config) return;

        const container = document.getElementById('configContainer');
        container.innerHTML = '';

        const editorEl = document.getElementById('configEditor');
        editorEl.style.display = 'block';

        // Name
        document.getElementById('configName').value = config.name;

        // Startfeld-Dropdown
        const rootFieldSelect = document.getElementById('rootField');
        rootFieldSelect.innerHTML = '<option value="">-- Startfeld wählen --</option>';
        for (const [fieldId, field] of Object.entries(this.enumFields)) {
            const selected = fieldId === config.rootField ? ' selected' : '';
            rootFieldSelect.innerHTML += `<option value="${fieldId}"${selected}>${this.getFieldLabel(fieldId)}</option>`;
        }

        // Abhängigkeitsbaum rendern
        this.renderRulesTree(config);
    },

    /**
     * Abhängigkeitsbaum rendern
     */
    renderRulesTree(config) {
        const treeContainer = document.getElementById('rulesTree');
        treeContainer.innerHTML = '';

        if (!config.rootField) {
            treeContainer.innerHTML = '<p class="hint">Bitte wählen Sie zuerst ein Startfeld aus.</p>';
            return;
        }

        const rootField = this.fields[config.rootField] || this.enumFields[config.rootField];
        if (!rootField) {
            treeContainer.innerHTML = '<p class="hint">Startfeld nicht gefunden.</p>';
            return;
        }

        // Werte des Startfelds auflisten
        const values = this.getFieldValues(config.rootField, rootField);
        if (values.length === 0) {
            treeContainer.innerHTML = '<p class="hint">Das Startfeld hat keine Auswahlwerte.</p>';
            return;
        }

        const html = this.renderValueBranches(values, config.rules || {}, [config.rootField], 0);
        treeContainer.innerHTML = html;

        // Event-Listener für dynamische Elemente
        this.attachTreeEventListeners();
    },

    /**
     * Wert-Zweige rendern (rekursiv)
     */
    renderValueBranches(values, rules, fieldPath, depth) {
        const indent = depth * 20;

        return values.map(val => {
            const valueKey = String(val.ID || val.id || val.value);
            const valueLabel = val.VALUE || val.label || val.value;
            const rule = rules[valueKey] || { showFields: [], requiredFields: [], nested: {} };

            const hasFields = rule.showFields && rule.showFields.length > 0;

            return `
                <div class="rule-branch" style="margin-left: ${indent}px;" data-value="${this.escapeHtml(valueKey)}" data-path="${fieldPath.join('.')}">
                    <div class="rule-header" onclick="Settings.toggleBranch(this)">
                        <span class="branch-toggle">${hasFields ? '&#9660;' : '&#9654;'}</span>
                        <span class="value-badge">= "${this.escapeHtml(valueLabel)}"</span>
                        <span class="field-count">${rule.showFields ? rule.showFields.length : 0} Feld(er)</span>
                    </div>
                    <div class="rule-body" style="${hasFields ? '' : 'display:none;'}">
                        <div class="field-selector">
                            <label>Anzuzeigende Felder:</label>
                            ${this.renderFieldMultiSelect(rule.showFields || [], fieldPath, valueKey, 'show')}
                        </div>
                        <div class="field-selector">
                            <label>Davon Pflichtfelder:</label>
                            ${this.renderRequiredFieldCheckboxes(rule.showFields || [], rule.requiredFields || [], fieldPath, valueKey)}
                        </div>
                        ${this.renderNestedDependencies(rule, fieldPath, valueKey, depth)}
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Feld-Mehrfachauswahl rendern
     */
    renderFieldMultiSelect(selectedFields, fieldPath, valueKey, type) {
        const pathStr = fieldPath.join('.');
        const selectId = `fields_${pathStr}_${valueKey}_${type}`;

        let html = `<div class="multi-select" id="${selectId}">`;
        html += `<button class="btn btn-sm btn-add" onclick="Settings.openFieldPicker('${selectId}', '${pathStr}', '${valueKey}')">+ Feld hinzufügen</button>`;

        if (selectedFields.length > 0) {
            html += '<div class="selected-fields">';
            selectedFields.forEach(fieldId => {
                html += `
                    <div class="selected-field-tag" data-field-id="${fieldId}">
                        <span>${this.getFieldLabel(fieldId)}</span>
                        <button class="tag-remove" onclick="Settings.removeFieldFromRule('${pathStr}', '${valueKey}', '${fieldId}')">&times;</button>
                    </div>`;
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Pflichtfeld-Checkboxen rendern
     */
    renderRequiredFieldCheckboxes(showFields, requiredFields, fieldPath, valueKey) {
        if (showFields.length === 0) {
            return '<p class="hint-small">Erst Felder hinzufügen.</p>';
        }

        const pathStr = fieldPath.join('.');
        return showFields.map(fieldId => {
            const checked = requiredFields.includes(fieldId) ? ' checked' : '';
            return `
                <label class="checkbox-label">
                    <input type="checkbox" ${checked}
                        onchange="Settings.toggleRequired('${pathStr}', '${valueKey}', '${fieldId}', this.checked)">
                    ${this.getFieldLabel(fieldId)}
                </label>`;
        }).join('');
    },

    /**
     * Verschachtelte Abhängigkeiten rendern
     */
    renderNestedDependencies(rule, fieldPath, valueKey, depth) {
        if (!rule.showFields || rule.showFields.length === 0) return '';

        // Nur Enum-Felder unter den angezeigten Feldern können weitere Abhängigkeiten haben
        const nestedEnumFields = rule.showFields.filter(fId => {
            const field = this.fields[fId];
            return field && (field.type === 'enumeration' || field.type === 'crm_status' || field.type === 'boolean');
        });

        if (nestedEnumFields.length === 0) return '';

        let html = '<div class="nested-deps">';
        html += '<h4>Verschachtelte Abhängigkeiten:</h4>';

        nestedEnumFields.forEach(childFieldId => {
            const childField = this.fields[childFieldId];
            const childValues = this.getFieldValues(childFieldId, childField);
            const nestedRules = (rule.nested && rule.nested[childFieldId]) || {};
            const newPath = [...fieldPath, valueKey, childFieldId];

            html += `
                <div class="nested-field-group">
                    <div class="nested-field-header">
                        <span class="field-icon">&#8627;</span>
                        <strong>${this.getFieldLabel(childFieldId)}</strong>
                    </div>
                    ${this.renderValueBranches(childValues, nestedRules, newPath, depth + 1)}
                </div>`;
        });

        html += '</div>';
        return html;
    },

    /**
     * Feld-Picker Dialog öffnen
     */
    openFieldPicker(selectId, pathStr, valueKey) {
        // Bereits ausgewählte Felder ermitteln
        const rule = this.getRuleByPath(pathStr, valueKey);
        const selectedFields = rule ? (rule.showFields || []) : [];

        // Modal erstellen
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'fieldPickerModal';

        let fieldsHtml = '';
        for (const [fieldId, field] of Object.entries(this.fields)) {
            if (selectedFields.includes(fieldId)) continue;
            const typeLabel = this.getFieldTypeLabel(field.type);
            fieldsHtml += `
                <div class="picker-field-item" onclick="Settings.addFieldToRule('${pathStr}', '${valueKey}', '${fieldId}')">
                    <span class="picker-field-name">${this.getFieldLabel(fieldId)}</span>
                    <span class="picker-field-type">${typeLabel}</span>
                </div>`;
        }

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Feld hinzufügen</h3>
                    <button class="modal-close" onclick="Settings.closeFieldPicker()">&times;</button>
                </div>
                <div class="modal-search">
                    <input type="text" id="fieldSearchInput" placeholder="Feld suchen..." oninput="Settings.filterFields(this.value)">
                </div>
                <div class="modal-body" id="fieldPickerList">
                    ${fieldsHtml || '<p class="hint">Keine weiteren Felder verfügbar.</p>'}
                </div>
            </div>`;

        document.body.appendChild(modal);
        document.getElementById('fieldSearchInput').focus();
    },

    /**
     * Felder im Picker filtern
     */
    filterFields(searchTerm) {
        const items = document.querySelectorAll('#fieldPickerList .picker-field-item');
        const term = searchTerm.toLowerCase();
        items.forEach(item => {
            const name = item.querySelector('.picker-field-name').textContent.toLowerCase();
            item.style.display = name.includes(term) ? '' : 'none';
        });
    },

    /**
     * Feld-Picker schließen
     */
    closeFieldPicker() {
        const modal = document.getElementById('fieldPickerModal');
        if (modal) modal.remove();
    },

    /**
     * Feld zu einer Regel hinzufügen
     */
    addFieldToRule(pathStr, valueKey, fieldId) {
        const rule = this.getOrCreateRuleByPath(pathStr, valueKey);
        if (!rule.showFields) rule.showFields = [];
        if (!rule.showFields.includes(fieldId)) {
            rule.showFields.push(fieldId);
        }
        this.closeFieldPicker();
        this.refreshEditor();
    },

    /**
     * Feld aus einer Regel entfernen
     */
    removeFieldFromRule(pathStr, valueKey, fieldId) {
        const rule = this.getRuleByPath(pathStr, valueKey);
        if (rule && rule.showFields) {
            rule.showFields = rule.showFields.filter(f => f !== fieldId);
            if (rule.requiredFields) {
                rule.requiredFields = rule.requiredFields.filter(f => f !== fieldId);
            }
            // Auch verschachtelte Regeln für dieses Feld entfernen
            if (rule.nested) {
                delete rule.nested[fieldId];
            }
        }
        this.refreshEditor();
    },

    /**
     * Pflichtfeld-Status umschalten
     */
    toggleRequired(pathStr, valueKey, fieldId, isRequired) {
        const rule = this.getOrCreateRuleByPath(pathStr, valueKey);
        if (!rule.requiredFields) rule.requiredFields = [];
        if (isRequired) {
            if (!rule.requiredFields.includes(fieldId)) {
                rule.requiredFields.push(fieldId);
            }
        } else {
            rule.requiredFields = rule.requiredFields.filter(f => f !== fieldId);
        }
    },

    /**
     * Zweig auf-/zuklappen
     */
    toggleBranch(headerEl) {
        const body = headerEl.nextElementSibling;
        const toggle = headerEl.querySelector('.branch-toggle');
        if (body.style.display === 'none') {
            body.style.display = '';
            toggle.innerHTML = '&#9660;';
        } else {
            body.style.display = 'none';
            toggle.innerHTML = '&#9654;';
        }
    },

    // --- Hilfsfunktionen für Regelbaum-Navigation ---

    /**
     * Regel über Pfad finden
     */
    getRuleByPath(pathStr, valueKey) {
        const config = this.configs.configs.find(c => c.id === this.editingConfigId);
        if (!config) return null;

        const pathParts = pathStr.split('.');
        let currentRules = config.rules;

        // Pfad navigieren: rootField -> value -> childField -> value -> ...
        // pathParts[0] = rootField
        // Wenn pathParts.length > 1, dann navigieren wir tiefer
        for (let i = 1; i < pathParts.length; i += 2) {
            const val = pathParts[i];
            const childField = pathParts[i + 1];
            if (!currentRules || !currentRules[val]) return null;
            if (!childField) {
                // Wir sind am Ende, valueKey ist im aktuellen Level
                return currentRules[val];
            }
            if (!currentRules[val].nested || !currentRules[val].nested[childField]) return null;
            currentRules = currentRules[val].nested[childField];
        }

        return currentRules ? currentRules[valueKey] : null;
    },

    /**
     * Regel über Pfad finden oder erstellen
     */
    getOrCreateRuleByPath(pathStr, valueKey) {
        const config = this.configs.configs.find(c => c.id === this.editingConfigId);
        if (!config) return {};

        if (!config.rules) config.rules = {};

        const pathParts = pathStr.split('.');
        let currentRules = config.rules;

        for (let i = 1; i < pathParts.length; i += 2) {
            const val = pathParts[i];
            const childField = pathParts[i + 1];
            if (!currentRules[val]) {
                currentRules[val] = { showFields: [], requiredFields: [], nested: {} };
            }
            if (!childField) break;
            if (!currentRules[val].nested) currentRules[val].nested = {};
            if (!currentRules[val].nested[childField]) currentRules[val].nested[childField] = {};
            currentRules = currentRules[val].nested[childField];
        }

        if (!currentRules[valueKey]) {
            currentRules[valueKey] = { showFields: [], requiredFields: [], nested: {} };
        }

        return currentRules[valueKey];
    },

    /**
     * Editor nach Änderung aktualisieren
     */
    refreshEditor() {
        if (this.editingConfigId) {
            this.editConfig(this.editingConfigId);
        }
    },

    // --- Speichern / Laden ---

    /**
     * Startfeld geändert
     */
    onRootFieldChange(fieldId) {
        const config = this.configs.configs.find(c => c.id === this.editingConfigId);
        if (!config) return;
        config.rootField = fieldId;
        config.rules = {}; // Regeln zurücksetzen bei Feldwechsel
        this.renderRulesTree(config);
    },

    /**
     * Konfigurationsname geändert
     */
    onConfigNameChange(name) {
        const config = this.configs.configs.find(c => c.id === this.editingConfigId);
        if (config) config.name = name;
    },

    /**
     * Konfiguration speichern
     */
    async saveConfig() {
        const saveBtn = document.getElementById('saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Speichern...';

        try {
            await B24.saveConfig(this.currentEntityType, this.configs);
            this.showSuccess('Konfiguration erfolgreich gespeichert!');
        } catch (error) {
            this.showError('Fehler beim Speichern: ' + (error.message || error));
            console.error(error);
        }

        saveBtn.disabled = false;
        saveBtn.textContent = 'Speichern';
    },

    /**
     * Konfiguration löschen
     */
    async deleteConfig(configId) {
        if (!confirm('Möchten Sie diese Konfiguration wirklich löschen?')) return;

        this.configs.configs = this.configs.configs.filter(c => c.id !== configId);
        try {
            await B24.saveConfig(this.currentEntityType, this.configs);
            this.showSuccess('Konfiguration gelöscht.');
            this.renderConfigList();
        } catch (error) {
            this.showError('Fehler beim Löschen: ' + (error.message || error));
        }
    },

    /**
     * Zurück zur Liste
     */
    backToList() {
        this.editingConfigId = null;
        document.getElementById('configEditor').style.display = 'none';
        this.renderConfigList();
    },

    // --- Hilfsfunktionen ---

    getFieldLabel(fieldId) {
        if (!fieldId) return '(nicht gesetzt)';
        const field = this.fields[fieldId];
        if (!field) return fieldId;
        return (field.formLabel || field.listLabel || field.title || fieldId) + ` [${fieldId}]`;
    },

    getFieldTypeLabel(type) {
        const labels = {
            'string': 'Text',
            'integer': 'Ganzzahl',
            'double': 'Dezimalzahl',
            'boolean': 'Ja/Nein',
            'datetime': 'Datum/Zeit',
            'date': 'Datum',
            'enumeration': 'Auswahlliste',
            'crm_status': 'CRM Status',
            'money': 'Geld',
            'url': 'URL',
            'address': 'Adresse',
            'employee': 'Mitarbeiter',
            'file': 'Datei',
            'crm': 'CRM-Verknüpfung'
        };
        return labels[type] || type;
    },

    getFieldValues(fieldId, field) {
        if (!field) return [];

        if (field.type === 'boolean') {
            return [
                { ID: '1', VALUE: 'Ja' },
                { ID: '0', VALUE: 'Nein' }
            ];
        }

        if (field.type === 'enumeration' && field.items) {
            return field.items;
        }

        if (field.type === 'crm_status' && field.statusType) {
            // CRM Statuswerte müssen separat geladen werden
            return field.items || [];
        }

        return [];
    },

    countRules(rules) {
        if (!rules) return 0;
        let count = 0;
        for (const val of Object.values(rules)) {
            if (val.showFields && val.showFields.length > 0) count++;
            if (val.nested) {
                for (const nestedRules of Object.values(val.nested)) {
                    count += this.countRules(nestedRules);
                }
            }
        }
        return count;
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    attachTreeEventListeners() {
        // Event-Listener werden inline über onclick gesetzt
    },

    showLoading(show) {
        document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
    },

    showError(msg) {
        this.showToast(msg, 'error');
    },

    showSuccess(msg) {
        this.showToast(msg, 'success');
    },

    showToast(msg, type) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = msg;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('visible'), 10);
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};
