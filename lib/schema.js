'use strict';
// Layered JSON-LD builders (Phase 6). Every page references the global #organization node.

const SITE = 'https://www.alarahomecare.com';
const ORG_ID = SITE + '/#organization';

function orgNode() {
  return {
    '@type': ['MedicalOrganization', 'HomeHealthCare', 'LocalBusiness'],
    '@id': ORG_ID,
    name: 'Alara Home Care',
    url: SITE + '/',
    telephone: '+1-702-814-9630',
    email: 'info@alarahomecare.com',
    areaServed: ['Las Vegas NV', 'Henderson NV', 'North Las Vegas NV', 'Clark County NV', 'Southern Nevada'],
    medicalSpecialty: ['Wound Care', 'Infusion Therapy', 'Skilled Nursing', 'Physical Therapy'],
    knowsAbout: ['EEOICPA', 'White Card benefits', 'OWCP', 'FECA', 'VA Community Care Network', 'home health']
  };
}

function breadcrumb(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: SITE + it.path
    }))
  };
}

// DefinedTerm + MedicalWebPage(+FAQ) + Breadcrumb + Org — the glossary citation workhorse.
function glossaryGraph(term, breadcrumbItems) {
  const termId = `${SITE}/glossary/${term.slug}/#term`;
  const pageId = `${SITE}/glossary/${term.slug}/#webpage`;
  const graph = [
    {
      '@type': 'DefinedTerm', '@id': termId, name: term.term,
      description: term.shortDefinition,
      inDefinedTermSet: {
        '@type': 'DefinedTermSet', '@id': SITE + '/glossary/#set',
        name: 'AlaraOS Federal Benefits & Home Health Glossary'
      }
    },
    {
      '@type': 'MedicalWebPage', '@id': pageId, url: `${SITE}/glossary/${term.slug}/`,
      name: `What is ${term.term}?`,
      lastReviewed: term.lastReviewed,
      reviewedBy: term.reviewer ? { '@type': 'Person', name: term.reviewer.name, jobTitle: term.reviewer.role } : undefined,
      about: { '@id': termId },
      publisher: { '@id': ORG_ID },
      citation: (term.sources || []).map(s => s.url)
    },
    breadcrumb(breadcrumbItems),
    orgNode()
  ];
  return { '@context': 'https://schema.org', '@graph': graph };
}

function faqGraph(faqs, breadcrumbItems) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map(f => ({
          '@type': 'Question', name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a }
        }))
      },
      breadcrumb(breadcrumbItems),
      orgNode()
    ]
  };
}

function basicPageGraph(name, path, breadcrumbItems) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'MedicalWebPage', '@id': SITE + path + '#webpage', url: SITE + path, name, publisher: { '@id': ORG_ID } },
      breadcrumb(breadcrumbItems),
      orgNode()
    ]
  };
}

module.exports = { orgNode, breadcrumb, glossaryGraph, faqGraph, basicPageGraph, SITE };
