/**
 * Bitrix24 REST API Wrapper
 * Abhängige Felder Plugin
 */
const B24 = {
    // Entity-Typ Konfiguration
    entityTypes: {
        deal: {
            id: 'deal',
            label: 'Deals',
            entityTypeId: 2,
            fieldsMethod: 'crm.deal.fields',
            getMethod: 'crm.deal.get',
            updateMethod: 'crm.deal.update',
            listMethod: 'crm.deal.list',
            fieldPrefix: 'UF_CRM_'
        },
        lead: {
            id: 'lead',
            label: 'Leads',
            entityTypeId: 1,
            fieldsMethod: 'crm.lead.fields',
            getMethod: 'crm.lead.get',
            updateMethod: 'crm.lead.update',
            listMethod: 'crm.lead.list',
            fieldPrefix: 'UF_CRM_'
        },
        contact: {
            id: 'contact',
            label: 'Kontakte',
            entityTypeId: 3,
            fieldsMethod: 'crm.contact.fields',
            getMethod: 'crm.contact.get',
            updateMethod: 'crm.contact.update',
            listMethod: 'crm.contact.list',
            fieldPrefix: 'UF_CRM_'
        },
        company: {
            id: 'company',
            label: 'Unternehmen',
            entityTypeId: 4,
            fieldsMethod: 'crm.company.fields',
            getMethod: 'crm.company.get',
            updateMethod: 'crm.company.update',
            listMethod: 'crm.company.list',
            fieldPrefix: 'UF_CRM_'
        }
    },

    // Smart Process Typen (werden dynamisch geladen)
    smartProcessTypes: [],

    /**
     * BX24 REST API Aufruf (Promise-basiert)
     */
    callMethod(method, params = {}) {
        return new Promise((resolve, reject) => {
            BX24.callMethod(method, params, (result) => {
                if (result.error()) {
                    reject(result.error());
                } else {
                    resolve(result.data());
                }
            });
        });
    },

    /**
     * Batch-Aufruf für mehrere API-Requests
     */
    callBatch(calls, haltOnError = false) {
        return new Promise((resolve, reject) => {
            BX24.callBatch(calls, (results) => {
                const data = {};
                let hasError = false;
                for (const key in results) {
                    if (results[key].error()) {
                        hasError = true;
                        if (haltOnError) {
                            reject(results[key].error());
                            return;
                        }
                    } else {
                        data[key] = results[key].data();
                    }
                }
                resolve(data);
            }, haltOnError);
        });
    },

    /**
     * Smart Process Typen laden
     */
    async loadSmartProcessTypes() {
        try {
            const result = await this.callMethod('crm.type.list');
            this.smartProcessTypes = (result.types || []).map(type => ({
                id: 'smart_' + type.entityTypeId,
                label: type.title,
                entityTypeId: type.entityTypeId,
                fieldsMethod: 'crm.item.fields',
                getMethod: 'crm.item.get',
                updateMethod: 'crm.item.update',
                listMethod: 'crm.item.list',
                fieldPrefix: 'uf_crm_',
                isSmart: true
            }));
            return this.smartProcessTypes;
        } catch (e) {
            console.warn('Smart Processes konnten nicht geladen werden:', e);
            this.smartProcessTypes = [];
            return [];
        }
    },

    /**
     * Alle Entity-Typen inkl. Smart Processes
     */
    getAllEntityTypes() {
        const types = { ...this.entityTypes };
        this.smartProcessTypes.forEach(sp => {
            types[sp.id] = sp;
        });
        return types;
    },

    /**
     * Felder eines Entity-Typs laden
     */
    async getFields(entityType) {
        const config = this.getAllEntityTypes()[entityType];
        if (!config) throw new Error('Unbekannter Entity-Typ: ' + entityType);

        const params = config.isSmart ? { entityTypeId: config.entityTypeId } : {};
        const fields = await this.callMethod(config.fieldsMethod, params);

        // Nur benutzerdefinierte Felder und relevante Systemfelder filtern
        const result = {};
        for (const [fieldId, field] of Object.entries(fields)) {
            // Benutzerdefinierte Felder (UF_CRM_*) und einige Systemfelder
            if (fieldId.toUpperCase().startsWith('UF_CRM_') ||
                fieldId.toUpperCase().startsWith('UF_') ||
                ['STAGE_ID', 'STATUS_ID', 'CATEGORY_ID', 'TYPE_ID',
                 'SOURCE_ID', 'CURRENCY_ID', 'COMPANY_ID'].includes(fieldId)) {
                result[fieldId] = {
                    ...field,
                    fieldId: fieldId
                };
            }
        }
        return result;
    },

    /**
     * Nur Felder mit Aufzählungswerten (für Parent-Felder geeignet)
     */
    async getEnumFields(entityType) {
        const allFields = await this.getFields(entityType);
        const enumFields = {};
        for (const [fieldId, field] of Object.entries(allFields)) {
            if (field.type === 'enumeration' ||
                field.type === 'crm_status' ||
                field.type === 'boolean') {
                enumFields[fieldId] = field;
            }
        }
        return enumFields;
    },

    /**
     * Entity-Daten laden
     */
    async getEntity(entityType, entityId) {
        const config = this.getAllEntityTypes()[entityType];
        if (!config) throw new Error('Unbekannter Entity-Typ: ' + entityType);

        const params = config.isSmart
            ? { entityTypeId: config.entityTypeId, id: entityId }
            : { id: entityId };

        return await this.callMethod(config.getMethod, params);
    },

    /**
     * Entity-Daten aktualisieren
     */
    async updateEntity(entityType, entityId, fields) {
        const config = this.getAllEntityTypes()[entityType];
        if (!config) throw new Error('Unbekannter Entity-Typ: ' + entityType);

        const params = config.isSmart
            ? { entityTypeId: config.entityTypeId, id: entityId, fields: fields }
            : { id: entityId, fields: fields };

        return await this.callMethod(config.updateMethod, params);
    },

    // --- Konfigurationsspeicher (app.option) ---

    /**
     * Konfiguration für einen Entity-Typ speichern
     */
    async saveConfig(entityType, config) {
        const key = 'depfields_' + entityType;
        const value = JSON.stringify(config);
        return await this.callMethod('app.option.set', {
            options: { [key]: value }
        });
    },

    /**
     * Konfiguration für einen Entity-Typ laden
     */
    async loadConfig(entityType) {
        const key = 'depfields_' + entityType;
        const options = await this.callMethod('app.option.get');
        if (options && options[key]) {
            try {
                return JSON.parse(options[key]);
            } catch (e) {
                console.error('Fehler beim Parsen der Konfiguration:', e);
                return { configs: [] };
            }
        }
        return { configs: [] };
    },

    /**
     * Alle Konfigurationen laden
     */
    async loadAllConfigs() {
        const options = await this.callMethod('app.option.get');
        const allConfigs = {};
        if (options) {
            for (const [key, value] of Object.entries(options)) {
                if (key.startsWith('depfields_')) {
                    const entityType = key.replace('depfields_', '');
                    try {
                        allConfigs[entityType] = JSON.parse(value);
                    } catch (e) {
                        allConfigs[entityType] = { configs: [] };
                    }
                }
            }
        }
        return allConfigs;
    },

    /**
     * Eindeutige ID generieren
     */
    generateId() {
        return 'df_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    // --- Debug-Hilfsfunktionen ---

    /**
     * Registrierte Placements abfragen
     */
    async getRegisteredPlacements() {
        try {
            return await this.callMethod('placement.list');
        } catch (e) {
            console.error('placement.list Fehler:', e);
            return [];
        }
    },

    /**
     * Registrierte UserField-Typen abfragen
     */
    async getRegisteredFieldTypes() {
        try {
            return await this.callMethod('userfieldtype.list');
        } catch (e) {
            console.error('userfieldtype.list Fehler:', e);
            return [];
        }
    }
};
