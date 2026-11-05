<!--
ENTWURF / DRAFT – Stand 05.11.2026. Gekürzte englische Übersetzung von avv.de.md; Freigabe durch Gründer/Anwalt erforderlich.
Prüf- und Umsetzungspunkte (verschlüsselte Backups umsetzen, Meldefrist, Kontrollrechte, Cloudflare-Proxy) siehe avv.de.md.
-->

# Data Processing Agreement (DPA)

Annex to the Askmetry Terms and Conditions · Last updated: 5 November 2026

*This is a shortened translation for convenience. Only the German version is legally binding.*

Between the **Customer** (controller) and **lindotech GmbH**, Eppendorfer Weg 151, 20253 Hamburg, Germany (processor, "we"), pursuant to Art. 28 GDPR. Concluded by accepting the Terms; applies where we process personal data on the Customer's behalf. It prevails over the Terms on data protection matters.

## 1. Subject matter, nature and purpose

Measuring brand visibility in AI services and preparing reports under the Terms: storing, transmitting to AI services, evaluating, presenting in reports, emailing reports, deleting. Purpose: solely providing the purchased services. This DPA covers only personal data the Customer enters itself – mainly in **questions, brand and competitor details** – and results containing such data. For account, billing and communication data we are the controller (see Privacy Policy).

## 2. Data and data subjects

Names of persons (e.g. owners, practitioners, consultants), person-related brand or company names, professional information and other details the Customer enters, plus related AI answers and sources. Data subjects: persons named by the Customer (e.g. its owners and staff, people behind competitors, industry figures). Special categories (Art. 9 GDPR) must not be entered.

## 3. Duration

As long as we process data on the Customer's behalf, until deletion under section 9.

## 4. Instructions

We process data only on documented instructions, which are set out in the Terms, this DPA and the Customer's use of Askmetry functions; further instructions in text form. We inform the Customer if we believe an instruction infringes data protection law and may suspend it until clarified.

## 5. Our obligations

Confidentiality of personnel; technical and organisational measures under Art. 32 GDPR (**Annex 1**); assistance with data subject requests and with Art. 32–36 GDPR; notification of personal data breaches **without undue delay, where possible within 48 hours**; processing on servers in Germany; third-country transfers only via sub-processors under Art. 44 et seq. GDPR.

## 6. Customer obligations

The Customer is responsible for the lawfulness of the data it enters, including informing data subjects, enters only data necessary for the measurement (inputs are sent to AI services) and reports irregularities promptly.

## 7. Sub-processors

General authorisation; current sub-processors are listed [here](/unterauftragnehmer) and are deemed approved. We give at least **30 days'** notice by email of new or replaced sub-processors; the Customer may object on reasonable data protection grounds and, failing a solution, terminate the account (unstarted reports are refunded). Sub-processors are bound by equivalent obligations; third-country transfers rely on the EU-US Data Privacy Framework or Standard Contractual Clauses.

## 8. Audits

Information on request (TOMs, sub-processor certificates). Where insufficient, audits by the Customer or an independent auditor bound to confidentiality, with at least **30 days'** notice, during business hours; the Customer bears its own costs and reasonable compensation for our effort unless a breach is found. Supervisory authorities' rights remain unaffected.

## 9. Deletion

The Customer can edit and delete its data in the account and download reports as PDF. After the end of services, at the latest upon account deletion, we delete the data within **30 days**, and from backups within a further **30 days**, unless retention is required by law; confirmation in text form on request.

## 10. Liability

Art. 82 GDPR; otherwise the Terms. German law and jurisdiction as in the Terms.

## Annex 1: Technical and organisational measures

- **Confidentiality:** hosting at Hetzner Online GmbH in data centres in Germany (ISO/IEC 27001); admin access restricted to named lindotech staff, SSH key only, database not reachable from the internet; **tenant separation** – every access checked against workspace membership; password, confirmation-code and IP **hashing**; secrets only in server configuration.
- **Integrity:** **TLS encryption in transit** for all connections; payment confirmations accepted only via signed webhooks; no personal data in operational notifications.
- **Availability:** regular **encrypted backups**, stored separately, retained 30 days; rate and cost limits; timely security updates.
- **Review:** open-source code with automated tests; review of these measures at least annually and on major changes; data minimisation and retention periods per the Privacy Policy.
