import React from 'react';
import { Provider } from '../types';

interface ProviderSelectionProps {
  providers: Provider[];
  onToggle: (providerId: string) => void;
}

export function ProviderSelection({ providers, onToggle }: ProviderSelectionProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-200">AI Providers</h3>
      
      <div className="grid grid-cols-4 gap-3">
        {providers.map((provider, index) => (
          <label
            key={provider.id}
            className={`relative p-3 border rounded-lg cursor-pointer transition-all duration-200 ${
              provider.enabled
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-600 bg-gray-800/30 hover:border-gray-500'
            } ${
              !provider.available ? 'opacity-50 cursor-not-allowed' : 'hover:scale-102'
            }`}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={() => provider.available && onToggle(provider.id)}
              disabled={!provider.available}
              className="sr-only"
              aria-label={`Toggle ${provider.name}`}
            />
            
            <div className="flex flex-col items-center space-y-2">
              <div className="w-8 h-8 bg-gradient-to-br from-gray-600 to-gray-700 rounded-full flex items-center justify-center text-xs font-bold text-white">
                {provider.name.charAt(0)}
              </div>
              
              <span className={`text-xs font-medium ${
                provider.enabled ? 'text-blue-300' : 'text-gray-400'
              }`}>
                {provider.name}
              </span>
            </div>
            
            {provider.enabled && (
              <div className="absolute top-1 right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full"></div>
              </div>
            )}
            
            {!provider.available && (
              <div className="absolute inset-0 bg-gray-800/50 rounded-lg flex items-center justify-center">
                <span className="text-xs text-gray-400">Unavailable</span>
              </div>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}