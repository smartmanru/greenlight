import React from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Friends sidebar without Xbox Friends API polling.
 * Always shows the offline / empty state; no IPC refresh timers.
 */
function SidebarFriends() {
    const { t } = useTranslation()

    return (
        <React.Fragment>
            <div id="components_sidebarfriends" key="components_sidebarfriends">
                <div className='components_sidebarfrienditem'>
                    <div className='components_sidebarfrienditem_userdetails'>
                        <p>{t('friends.allFriendsOffline')}</p>
                    </div>
                </div>
            </div>
        </React.Fragment>
    )
}

export default SidebarFriends
