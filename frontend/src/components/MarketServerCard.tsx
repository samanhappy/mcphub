import React from 'react';
import { useTranslation } from 'react-i18next';
import { MarketServer } from '@/types';

interface MarketServerCardProps {
  server: MarketServer;
  onClick: (server: MarketServer) => void;
}

const MarketServerCard: React.FC<MarketServerCardProps> = ({ server, onClick }) => {
  const { t } = useTranslation();

  // Intelligently calculate how many tags to display to ensure they fit in a single line
  const getTagsToDisplay = () => {
    if (!server.tags || server.tags.length === 0) {
      return { tagsToShow: [], hasMore: false, moreCount: 0 };
    }

    // Estimate available width in the card (in characters)
    const estimatedAvailableWidth = 28; // Estimated number of characters that can fit in one line

    // Calculate the character space needed for tags and plus sign (including # and spacing)
    const calculateTagWidth = (tag: string) => tag.length + 3; // +3 for # and spacing

    // Loop to determine the maximum number of tags that can be displayed
    let totalWidth = 0;
    let i = 0;

    // First, sort tags by length to prioritize displaying shorter tags
    const sortedTags = [...server.tags].sort((a, b) => a.length - b.length);

    // Calculate how many tags can fit
    for (i = 0; i < sortedTags.length; i++) {
      const tagWidth = calculateTagWidth(sortedTags[i]);

      // If this tag would make the total width exceed available width, stop adding
      if (totalWidth + tagWidth > estimatedAvailableWidth) {
        break;
      }

      totalWidth += tagWidth;

      // If this is the last tag but there's still space, no need to show "more"
      if (i === sortedTags.length - 1) {
        return {
          tagsToShow: sortedTags,
          hasMore: false,
          moreCount: 0
        };
      }
    }

    // If there's not enough space to display any tags, show at least one
    if (i === 0 && sortedTags.length > 0) {
      i = 1;
    }

    // Calculate space needed for the "more" tag
    const moreCount = sortedTags.length - i;
    const moreTagWidth = 3 + String(moreCount).length + t('market.moreTags').length;

    // If there's enough remaining space to display the "more" tag
    if (totalWidth + moreTagWidth <= estimatedAvailableWidth || i < 1) {
      return {
        tagsToShow: sortedTags.slice(0, i),
        hasMore: true,
        moreCount
      };
    }

    // If there's not enough space for even the "more" tag, reduce one tag to make room
    return {
      tagsToShow: sortedTags.slice(0, Math.max(1, i - 1)),
      hasMore: true,
      moreCount: moreCount + 1
    };
  };

  const { tagsToShow, hasMore, moreCount } = getTagsToDisplay();

  return (
    <div
      className="bg-white rounded-lg shadow-md p-5 hover:shadow-lg transition-all duration-200 cursor-pointer flex flex-col h-full page-card"
      onClick={() => onClick(server)}
    >
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-semibold text-gray-900 line-clamp-1 mr-2">{server.display_name}</h3>
        {server.is_official && (
          <span className="text-xs font-medium px-2.5 py-0.5 rounded flex-shrink-0 label-primary">
            {t('market.official')}
          </span>
        )}
      </div>
      <p className="text-gray-600 text-sm mb-4 line-clamp-2 min-h-[40px]">{server.description}</p>

      {/* Categories */}
      <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
        {server.categories?.length > 0 ? (
          server.categories.map((category, index) => (
            <span
              key={index}
              className="bg-gray-100 text-gray-800 text-xs px-2 py-1.5 rounded whitespace-nowrap"
            >
              {category}
            </span>
          ))
        ) : (
          <span className="text-xs text-gray-400 py-1">-</span>
        )}
      </div>

      {/* Tags */}
      <div className="relative mb-3 min-h-[28px] overflow-x-auto">
        {server.tags?.length > 0 ? (
          <div className="flex gap-1 items-center whitespace-nowrap">
            {tagsToShow.map((tag, index) => (
              <span
                key={index}
                className="bg-green-50 text-green-700 text-xs px-2 py-1 rounded flex-shrink-0 label-secondary"
              >
                #{tag}
              </span>
            ))}
            {hasMore && (
              <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-1 rounded flex-shrink-0">
                +{moreCount} {t('market.moreTags')}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400 py-1">-</span>
        )}
      </div>

      <div className="flex justify-between items-center mt-auto pt-2 text-xs text-gray-500">
        <div className="overflow-hidden">
          <span className="whitespace-nowrap">{t('market.by')} </span>
          <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px] inline-block align-bottom">
            {server.author?.name || t('market.unknown')}
          </span>
        </div>
        <div className="flex items-center flex-shrink-0">
          <svg className="h-4 w-4 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
          </svg>
          <span>{server.tools?.length || 0} {t('market.tools')}</span>
        </div>
      </div>
    </div>
  );
};

export default MarketServerCard;