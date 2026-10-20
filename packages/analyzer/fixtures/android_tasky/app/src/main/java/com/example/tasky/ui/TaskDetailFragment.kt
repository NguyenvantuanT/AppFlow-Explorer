package com.example.tasky.ui

import android.os.Bundle
import android.view.View
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.example.tasky.R

class TaskDetailFragment : Fragment(R.layout.fragment_task_detail) {

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        view.findViewById<View>(R.id.btn_edit).setOnClickListener {
            findNavController().navigate(R.id.action_taskDetail_to_editTask)
        }
        view.findViewById<View>(R.id.btn_share).setOnClickListener {
            // No such action in nav_graph.xml: reported as a missing target.
            findNavController().navigate(R.id.action_taskDetail_to_share)
        }
        view.findViewById<View>(R.id.btn_delete).setOnClickListener {
            DeleteTaskDialog().show(childFragmentManager, "delete")
        }
    }
}
