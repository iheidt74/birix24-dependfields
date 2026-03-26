/**
 * CRM-Karten Widget - Abhängige Felder
 * Wird als Tab (placement.bind) oder Custom UserField in der CRM-Karte angezeigt
 */

const FieldWidget = {
    entityType: null,
    entityId: null,
    entityData: null,
    config: null,
    fields: {},
    currentValues: {},
    isLoading: false,

    /**
     * Initialisierung
     */
    async init() {
        this.showLoading(true);

        try {
            // Placement-Info ermitteln
            const placementInfo = this.getPlacementInfo();

            console.log('[DepFields] Placement-Info:', JSON.stringify(placementInfo));

            if (!placementInfo || (!placementInfo.entityType && !placementInfo.entityId)) {
                this.showMessage('Kein CRM-Kontext gefunden. Placement-Info: ' +
                    JSON.stringify(placementInfo), 'warning');
                return;
            }

            this.entityType = placementInfo.entityType;
            this.entityId = placementInfo.entityId;

            if (!this.entityType || !this.entityId) {
                this.showMessage('Entity-Typ: ' + (this.entityType || 'unbekannt') +
                    ', Entity-ID: ' + (this.entityId || 'unbekannt') +
                    ' - Informationen unvollständig.', 'warning');
                return;
            }

            // Smart Processes laden
            await B24.loadSmartProcessTypes();

            // Parallel: Felder, Entity-Daten und Konfiguration laden
            const [fields, entityData, config] = await Promise.all([
                B24.getFields(this.entityType),
                B24.getEntity(this.entityType, this.entityId),
                B24.loadConfig(this.entityType)
            ]);

            this.fields = fields;
            this.entityData = entityData;
            this.config = config;

            // Aktuelle Werte der Entity-Felder erfassen
            this.currentValues = {};
            for (const [fieldId, value] of Object.entries(entityData)) {
                this.currentValues[fieldId] = value;
            }

            // Widget rendern
            this.render();

        } catch (error) {
            console.error('Widget Init Fehler:', error);
            this.showMessage('Fehler beim Laden: ' + (error.message || error), 'error');
        }

        this.showLoading(false);
    },

    /**
     * Placement-Informationen auslesen
     */
    getPlacementInfo() {
        try {
            const placement = BX24.placement.info();
            console.log('[DepFields] Raw placement:', JSON.stringify(placement));

            let entityType = null;
            let entityId = null;

            if (placement) {
                const opts = placement.options || {};

                // 1. CRM_*_DETAIL_TAB Placements: Entity-ID direkt in options.ID
                if (opts.ID) {
                    entityId = String(opts.ID);
                }

                // 2. Fallback: ENTITY_VALUE_ID (Custom UserField Type)
                if (!entityId && opts.ENTITY_VALUE_ID) {
                    entityId = String(opts.ENTITY_VALUE_ID);
                }

                // 3. Fallback: ENTITY_ID Format "CRM_DEAL_123"
                if (opts.ENTITY_ID) {
                    const parts = opts.ENTITY_ID.split('_');
                    if (!entityId) {
                        entityId = parts[parts.length - 1];
                    }
                    if (parts.length >= 2) {
                        // Versuche Entity-Typ aus ENTITY_ID Prefix
                        const prefix = parts.slice(0, -1).join('_');
                        entityType = this.mapEntityPrefix(prefix);
                    }
                }

                // 4. Entity-Typ aus Placement-Code erkennen (z.B. CRM_DEAL_DETAIL_TAB)
                if (!entityType) {
                    entityType = this.detectEntityType(placement);
                }

                // 5. Fallback: ENTITY_TYPE_NAME in options
                if (!entityType && opts.ENTITY_TYPE_NAME) {
                    entityType = this.mapEntityPrefix(opts.ENTITY_TYPE_NAME);
                }
            }

            // 6. Letzter Fallback: URL-Parameter
            if (!entityType || !entityId) {
                const params = new URLSearchParams(window.location.search);
                if (!entityType) {
                    entityType = this.mapEntityPrefix(params.get('ENTITY') || params.get('entity'));
                }
                if (!entityId) {
                    entityId = params.get('ID') || params.get('id') || params.get('ENTITY_VALUE_ID');
                }
            }

            return { entityType, entityId };

        } catch (e) {
            console.error('[DepFields] Placement Info Fehler:', e);
            const params = new URLSearchParams(window.location.search);
            return {
                entityType: this.mapEntityPrefix(params.get('ENTITY')),
                entityId: params.get('ID') || params.get('ENTITY_VALUE_ID')
            };
        }
    },

    /**
     * Entity-Präfix zu internem Typ mappen
     */
    mapEntityPrefix(prefix) {
        if (!prefix) return null;
        const map = {
            'CRM_DEAL': 'deal', 'DEAL': 'deal', 'deal': 'deal', '2': 'deal',
            'CRM_LEAD': 'lead', 'LEAD': 'lead', 'lead': 'lead', '1': 'lead',
            'CRM_CONTACT': 'contact', 'CONTACT': 'contact', 'contact': 'contact', '3': 'contact',
            'CRM_COMPANY': 'company', 'COMPANY': 'company', 'company': 'company', '4': 'company'
        };
        if (map[prefix]) return map[prefix];

        // Smart Process prüfen
        const num = parseInt(prefix, 10);
        if (num && num > 127) return 'smart_' + num;

        return prefix.toLowerCase();
    },

    /**
     * Entity-Typ aus Placement-Kontext erkennen
     */
    detectEntityType(placement) {
        if (!placement) return null;
        const placementId = placement.placement || '';

        if (placementId.includes('DEAL')) return 'deal';
        if (placementId.includes('LEAD')) return 'lead';
        if (placementId.includes('CONTACT')) return 'contact';
        if (placementId.includes('COMPANY')) return 'company';

        // Smart Process: CRM_DYNAMIC_XXX_DETAIL_TAB
        const dynamicMatch = placementId.match(/CRM_DYNAMIC_(\d+)_DETAIL_TAB/);
        if (dynamicMatch) return 'smart_' + dynamicMatch[1];

        return null;
    },

    /**
     * Widget rendern
     */
    render() {
        const container = document.getElementById('widgetContent');

        if (!this.config || !this.config.configs || this.config.configs.length === 0) {
            container.innerHTML = '<div class="widget-empty">Keine Konfigurationen vorhanden. Bitte konfigurieren Sie die App in den Einstellungen.</div>';
            this.resizeFrame();
            return;
        }

        let html = '';

        // Alle Konfigurationen für diesen Entity-Typ durchgehen
        this.config.configs.forEach(cfg => {
            if (!cfg.rootField) return;

            html += '<div class="widget-config" data-config-id="' + cfg.id + '">';
            html += this.renderFieldChain(cfg, cfg.rootField, cfg.rules, []);
            html += '</div>';
        });

        if (!html) {
            container.innerHTML = '<div class="widget-empty">Keine aktiven Regeln für dieses Element.</div>';
        } else {
            container.innerHTML = html;
        }

        this.resizeFrame();
    },

    /**
     * Feld-Kette rekursiv rendern
     */
    renderFieldChain(config, fieldId, rules, parentPath) {
        const field = this.fields[fieldId];
        if (!field) return '';

        const currentValue = this.currentValues[fieldId];
        let html = '';

        // Feld-Input rendern
        html += this.renderFieldInput(fieldId, field, currentValue, parentPath);

        // Wenn ein Wert ausgewählt ist, abhängige Felder anzeigen
        if (currentValue && rules) {
            const valueKey = String(currentValue);
            const rule = rules[valueKey];

            if (rule && rule.showFields && rule.showFields.length > 0) {
                html += '<div class="dependent-fields" data-parent-value="' + this.escapeHtml(valueKey) + '">';

                rule.showFields.forEach(childFieldId => {
                    const childField = this.fields[childFieldId];
                    if (!childField) return;

                    const isRequired = rule.requiredFields && rule.requiredFields.includes(childFieldId);
                    const childValue = this.currentValues[childFieldId];
                    const newPath = [...parentPath, { field: fieldId, value: valueKey }];

                    // Pflichtfeld-Markierung
                    if (isRequired) {
                        html += '<div class="field-wrapper required">';
                    } else {
                        html += '<div class="field-wrapper">';
                    }

                    // Prüfen ob dieses Kind-Feld weitere Abhängigkeiten hat
                    const nestedRules = (rule.nested && rule.nested[childFieldId]) || null;
                    if (nestedRules) {
                        html += this.renderFieldChain(config, childFieldId, nestedRules, newPath);
                    } else {
                        html += this.renderFieldInput(childFieldId, childField, childValue, newPath);
                    }

                    html += '</div>';
                });

                html += '</div>';
            }
        }

        return html;
    },

    /**
     * Einzelnes Feld-Input rendern
     */
    renderFieldInput(fieldId, field, value, parentPath) {
        const label = field.formLabel || field.listLabel || field.title || fieldId;
        const isRequired = this.isFieldRequired(fieldId, parentPath);
        const requiredMark = isRequired ? ' <span class="required-mark">*</span>' : '';

        let html = `<div class="field-group" data-field-id="${fieldId}">`;
        html += `<label class="field-label">${this.escapeHtml(label)}${requiredMark}</label>`;

        switch (field.type) {
            case 'enumeration':
                html += this.renderEnumInput(fieldId, field, value);
                break;
            case 'boolean':
                html += this.renderBooleanInput(fieldId, value);
                break;
            case 'string':
            case 'url':
                html += this.renderTextInput(fieldId, value, 'text');
                break;
            case 'integer':
                html += this.renderTextInput(fieldId, value, 'number');
                break;
            case 'double':
            case 'money':
                html += this.renderTextInput(fieldId, value, 'number');
                break;
            case 'date':
                html += this.renderTextInput(fieldId, value, 'date');
                break;
            case 'datetime':
                html += this.renderTextInput(fieldId, value, 'datetime-local');
                break;
            case 'crm_status':
                html += this.renderEnumInput(fieldId, field, value);
                break;
            default:
                html += this.renderTextInput(fieldId, value, 'text');
        }

        html += '</div>';
        return html;
    },

    /**
     * Auswahllisten-Input
     */
    renderEnumInput(fieldId, field, value) {
        let html = `<select class="widget-input widget-select" data-field-id="${fieldId}" onchange="FieldWidget.onFieldChange('${fieldId}', this.value)">`;
        html += '<option value="">-- Bitte wählen --</option>';

        if (field.items) {
            field.items.forEach(item => {
                const itemId = String(item.ID || item.id);
                const selected = String(value) === itemId ? ' selected' : '';
                html += `<option value="${itemId}"${selected}>${this.escapeHtml(item.VALUE || item.value)}</option>`;
            });
        }

        html += '</select>';
        return html;
    },

    /**
     * Ja/Nein-Input
     */
    renderBooleanInput(fieldId, value) {
        let html = `<select class="widget-input widget-select" data-field-id="${fieldId}" onchange="FieldWidget.onFieldChange('${fieldId}', this.value)">`;
        html += '<option value="">-- Bitte wählen --</option>';
        html += `<option value="1"${value === '1' || value === 1 ? ' selected' : ''}>Ja</option>`;
        html += `<option value="0"${value === '0' || value === 0 ? ' selected' : ''}>Nein</option>`;
        html += '</select>';
        return html;
    },

    /**
     * Text-Input
     */
    renderTextInput(fieldId, value, type) {
        const val = value != null ? this.escapeHtml(String(value)) : '';
        return `<input type="${type}" class="widget-input" data-field-id="${fieldId}" value="${val}" onchange="FieldWidget.onFieldChange('${fieldId}', this.value)">`;
    },

    /**
     * Feld-Wertänderung verarbeiten
     */
    async onFieldChange(fieldId, newValue) {
        const oldValue = this.currentValues[fieldId];
        this.currentValues[fieldId] = newValue;

        // Bei Enum-Feldern: Abhängige Felder aktualisieren (leeren, wenn Elternwert sich ändert)
        const field = this.fields[fieldId];
        if (field && (field.type === 'enumeration' || field.type === 'crm_status' || field.type === 'boolean')) {
            this.clearDependentFieldValues(fieldId, oldValue);
        }

        // Wert in Bitrix24 speichern
        try {
            await B24.updateEntity(this.entityType, this.entityId, {
                [fieldId]: newValue || ''
            });
        } catch (error) {
            console.error('Fehler beim Speichern:', error);
            this.showFieldError(fieldId, 'Speichern fehlgeschlagen');
        }

        // Widget neu rendern für kaskadierende Effekte
        this.render();
    },

    /**
     * Abhängige Feldwerte leeren wenn Elternwert sich ändert
     */
    clearDependentFieldValues(parentFieldId, oldValue) {
        if (!this.config || !this.config.configs) return;

        this.config.configs.forEach(cfg => {
            this.clearDependentFieldsRecursive(cfg.rootField, cfg.rules, parentFieldId, oldValue);
        });
    },

    /**
     * Rekursiv abhängige Felder leeren
     */
    clearDependentFieldsRecursive(fieldId, rules, targetFieldId, targetOldValue) {
        if (!rules) return;

        for (const [valueKey, rule] of Object.entries(rules)) {
            if (fieldId === targetFieldId && valueKey === String(targetOldValue)) {
                // Alle Kindfelder dieser Regel leeren
                if (rule.showFields) {
                    rule.showFields.forEach(childFieldId => {
                        this.currentValues[childFieldId] = '';
                        // Auch verschachtelte Felder leeren
                        if (rule.nested && rule.nested[childFieldId]) {
                            this.clearAllNestedValues(rule.nested[childFieldId]);
                        }
                    });
                }
            }

            // Weiter in verschachtelte Regeln schauen
            if (rule.nested) {
                for (const [childFieldId, nestedRules] of Object.entries(rule.nested)) {
                    this.clearDependentFieldsRecursive(childFieldId, nestedRules, targetFieldId, targetOldValue);
                }
            }
        }
    },

    /**
     * Alle Werte in verschachtelten Regeln leeren
     */
    clearAllNestedValues(rules) {
        for (const rule of Object.values(rules)) {
            if (rule.showFields) {
                rule.showFields.forEach(fId => {
                    this.currentValues[fId] = '';
                });
            }
            if (rule.nested) {
                for (const nestedRules of Object.values(rule.nested)) {
                    this.clearAllNestedValues(nestedRules);
                }
            }
        }
    },

    /**
     * Prüfen ob ein Feld als Pflichtfeld markiert ist
     */
    isFieldRequired(fieldId, parentPath) {
        if (!this.config || !this.config.configs) return false;

        for (const cfg of this.config.configs) {
            if (this.checkRequiredInRules(fieldId, cfg.rules)) return true;
        }
        return false;
    },

    /**
     * Rekursiv prüfen ob Feld in den Regeln als Pflicht markiert ist
     */
    checkRequiredInRules(fieldId, rules) {
        if (!rules) return false;

        for (const rule of Object.values(rules)) {
            if (rule.requiredFields && rule.requiredFields.includes(fieldId)) return true;
            if (rule.nested) {
                for (const nestedRules of Object.values(rule.nested)) {
                    if (this.checkRequiredInRules(fieldId, nestedRules)) return true;
                }
            }
        }
        return false;
    },

    /**
     * Pflichtfeld-Validierung
     */
    validateRequired() {
        const errors = [];

        if (!this.config || !this.config.configs) return errors;

        this.config.configs.forEach(cfg => {
            this.validateRequiredRecursive(cfg.rootField, cfg.rules, errors);
        });

        return errors;
    },

    validateRequiredRecursive(fieldId, rules, errors) {
        if (!rules) return;

        const currentValue = this.currentValues[fieldId];
        if (!currentValue) return;

        const valueKey = String(currentValue);
        const rule = rules[valueKey];
        if (!rule) return;

        if (rule.requiredFields) {
            rule.requiredFields.forEach(reqFieldId => {
                if (!this.currentValues[reqFieldId]) {
                    const field = this.fields[reqFieldId];
                    const label = field ? (field.formLabel || field.title || reqFieldId) : reqFieldId;
                    errors.push(`"${label}" ist ein Pflichtfeld.`);
                }
            });
        }

        if (rule.nested) {
            for (const [childFieldId, nestedRules] of Object.entries(rule.nested)) {
                this.validateRequiredRecursive(childFieldId, nestedRules, errors);
            }
        }
    },

    /**
     * Fehlermeldung an einem Feld anzeigen
     */
    showFieldError(fieldId, message) {
        const fieldGroup = document.querySelector(`[data-field-id="${fieldId}"]`);
        if (!fieldGroup) return;

        const existingError = fieldGroup.querySelector('.field-error');
        if (existingError) existingError.remove();

        const errorEl = document.createElement('div');
        errorEl.className = 'field-error';
        errorEl.textContent = message;
        fieldGroup.appendChild(errorEl);

        setTimeout(() => errorEl.remove(), 3000);
    },

    /**
     * Iframe-Größe anpassen
     */
    resizeFrame() {
        try {
            // fitWindow passt sich automatisch an den Inhalt an
            BX24.fitWindow();
        } catch (e1) {
            try {
                const height = document.body.scrollHeight + 20;
                BX24.resizeWindow(document.body.scrollWidth, height);
            } catch (e2) {
                // Ignorieren wenn resize nicht verfügbar
            }
        }
    },

    // --- Hilfsfunktionen ---

    showLoading(show) {
        document.getElementById('widgetLoading').style.display = show ? 'block' : 'none';
    },

    showMessage(msg, type) {
        const content = document.getElementById('widgetContent');
        content.innerHTML = `<div class="widget-message widget-message-${type}">${this.escapeHtml(msg)}</div>`;
        this.resizeFrame();
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }
};
