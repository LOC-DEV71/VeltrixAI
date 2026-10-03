import { useEffect } from 'react';

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  structuredData?: any; // To inject JSON-LD
}

export function useSEO({ title, description, canonical, structuredData }: SEOProps) {
  useEffect(() => {
    if (title) {
      document.title = title;
      
      let metaOgTitle = document.querySelector('meta[property="og:title"]');
      if (!metaOgTitle) {
        metaOgTitle = document.createElement('meta');
        metaOgTitle.setAttribute('property', 'og:title');
        document.head.appendChild(metaOgTitle);
      }
      metaOgTitle.setAttribute('content', title);
    }

    if (description) {
      let metaDescription = document.querySelector('meta[name="description"]');
      if (!metaDescription) {
        metaDescription = document.createElement('meta');
        metaDescription.setAttribute('name', 'description');
        document.head.appendChild(metaDescription);
      }
      metaDescription.setAttribute('content', description);
      
      let metaOgDesc = document.querySelector('meta[property="og:description"]');
      if (!metaOgDesc) {
        metaOgDesc = document.createElement('meta');
        metaOgDesc.setAttribute('property', 'og:description');
        document.head.appendChild(metaOgDesc);
      }
      metaOgDesc.setAttribute('content', description);
    }

    if (canonical) {
      let linkCanonical = document.querySelector('link[rel="canonical"]');
      if (!linkCanonical) {
        linkCanonical = document.createElement('link');
        linkCanonical.setAttribute('rel', 'canonical');
        document.head.appendChild(linkCanonical);
      }
      linkCanonical.setAttribute('href', canonical);
      
      let metaOgUrl = document.querySelector('meta[property="og:url"]');
      if (!metaOgUrl) {
        metaOgUrl = document.createElement('meta');
        metaOgUrl.setAttribute('property', 'og:url');
        document.head.appendChild(metaOgUrl);
      }
      metaOgUrl.setAttribute('content', canonical);
    }
    
    if (structuredData) {
      const scriptId = 'json-ld-structured-data';
      let script = document.getElementById(scriptId) as HTMLScriptElement;
      if (!script) {
        script = document.createElement('script');
        script.id = scriptId;
        script.type = 'application/ld+json';
        document.head.appendChild(script);
      }
      script.text = JSON.stringify(structuredData);
    }
  }, [title, description, canonical, structuredData]);
}
