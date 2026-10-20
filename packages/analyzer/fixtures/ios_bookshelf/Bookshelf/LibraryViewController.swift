import UIKit

final class LibraryViewController: UIViewController, UITableViewDelegate {

    @IBOutlet private weak var tableView: UITableView!

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.register(UINib(nibName: "BookCell", bundle: nil), forCellReuseIdentifier: "BookCell")
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        performSegue(withIdentifier: "showBook", sender: indexPath)
    }

    @IBAction func settingsTapped(_ sender: Any) {
        navigationController?.pushViewController(SettingsHostingController(), animated: true)
    }

    @IBAction func statsTapped(_ sender: Any) {
        navigationController?.pushViewController(LegacyStatsViewController(), animated: true)
    }

    @IBAction func archiveTapped(_ sender: Any) {
        // No segue with this identifier exists in Main.storyboard.
        performSegue(withIdentifier: "showArchive", sender: nil)
    }
}
